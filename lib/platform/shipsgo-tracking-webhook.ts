import crypto from "node:crypto";
import type { Prisma, ShipsgoTracking } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError, isPlainRecord } from "./shared-base-utils";
import { getShipsgoIntegrationSettings } from "./freightower-integration";
import {
  assertFreightowerOceanEnabled,
  createFreightowerPayloadFromTracking,
  freightowerApiRequest,
  mapFreightowerShipmentPayload,
  mergeFreightowerWebhookPayload,
  parseFreightowerWebhookEnvelope,
  trackingUpdateFromFreightowerMappedShipment,
  verifyFreightowerWebhookSignature,
} from "./freightower-tracking";
import { serializeShipsgoTracking } from "./shipsgo-tracking-mapping";
import { FREIGHTOWER_PROVIDER } from "./shipsgo-tracking-utils";
import { loadShipsgoTrackingWithContainers } from "./shipsgo-tracking-service-shared";
import {
  claimWebhookReplay,
  completeWebhookReplayClaim,
  releaseWebhookReplayClaim,
} from "./webhook-replay-guard";
import {
  hasFreightowerTrackingNotificationChange,
} from "./shipsgo-tracking-notifications";
import {
  claimFreightowerTrackingSyncLease,
  releaseFreightowerTrackingSyncLease,
} from "./shipsgo-tracking-sync-lease";
import {
  FREIGHTOWER_NOTIFICATION_COMPREHENSIVE,
  markFreightowerNotificationPending,
  reconcileFreightowerTrackingNotification,
} from "./freightower-notification-pending";

const UNSIGNED_REQUERY_THROTTLE_MS = 30_000;

function freightowerWebhookFingerprint(rawBody: string) {
  return crypto.createHash("sha256").update(`${FREIGHTOWER_PROVIDER}\0${rawBody}`).digest("hex");
}

function parseWebhookJson(rawBody: string) {
  try {
    const payload: unknown = JSON.parse(rawBody);
    if (!isPlainRecord(payload)) throw new Error("Webhook body must be an object");
    return payload;
  } catch {
    throw codedError("飞驼可视推送正文不是有效 JSON 对象。", 400, "FREIGHTOWER_WEBHOOK_INVALID_BODY");
  }
}

function webhookTargetWhere(envelope: ReturnType<typeof parseFreightowerWebhookEnvelope>) {
  const OR: Prisma.ShipsgoTrackingWhereInput[] = [];
  if (envelope.references.length) OR.push({ reference: { in: envelope.references } });
  if (envelope.billNumbers.length) {
    OR.push({ masterBlNo: { in: envelope.billNumbers } }, { bookingNumber: { in: envelope.billNumbers } });
  }
  if (envelope.containerNumbers.length) {
    OR.push(
      { containerNumber: { in: envelope.containerNumbers } },
      { containers: { some: { containerNo: { in: envelope.containerNumbers } } } },
    );
  }
  return OR;
}

function webhookTrackingPatch(
  mapped: ReturnType<typeof mapFreightowerShipmentPayload>,
  before: ShipsgoTracking,
) {
  const trackingData = trackingUpdateFromFreightowerMappedShipment(mapped, before.rawResponse ?? before.rawPayload);
  if (mapped.syncStatus === "SUBSCRIBED") return trackingData;
  return {
    ...trackingData,
    shipsgoShipmentId: mapped.shipsgoShipmentId || before.shipsgoShipmentId,
    masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
    reference: mapped.reference || before.reference,
    carrierScac: mapped.carrierScac || before.carrierScac,
    carrierName: mapped.carrierName || before.carrierName,
    bookingNumber: mapped.bookingNumber || before.bookingNumber,
    containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
    status: mapped.status && mapped.status !== "UNKNOWN" ? mapped.status : before.status,
    currentStatus: mapped.currentStatus && mapped.currentStatus !== "UNKNOWN" ? mapped.currentStatus : before.currentStatus,
    originName: mapped.originName || before.originName,
    destinationName: mapped.destinationName || before.destinationName,
    dateOfLoading: mapped.dateOfLoading || before.dateOfLoading,
    dateOfDischarge: mapped.dateOfDischarge || before.dateOfDischarge,
    predictedDischargeDate: mapped.predictedDischargeDate || before.predictedDischargeDate,
    eta: mapped.eta || before.eta,
    vesselName: mapped.vesselName || before.vesselName,
    voyage: mapped.voyage || before.voyage,
    mapUrl: mapped.mapUrl || before.mapUrl,
    lastEvent: mapped.lastEvent && mapped.lastEvent !== "UNKNOWN" ? mapped.lastEvent : before.lastEvent,
    lastEventAt: mapped.lastEventAt || before.lastEventAt,
    syncStatus: "WEBHOOK_SYNCED",
    syncMessage: "",
  };
}

export async function handleShipsgoWebhook(rawBody: string, _signature: unknown, headers?: Headers) {
  const settings = await getShipsgoIntegrationSettings();
  assertFreightowerOceanEnabled(settings);
  if (!settings.webhookEnabled) throw codedError("飞驼可视推送未启用。", 400, "FREIGHTOWER_WEBHOOK_DISABLED");
  const signatureConfigured = Boolean(settings.freightowerWebhookAccessSecret);
  const signatureVerified = Boolean(headers && verifyFreightowerWebhookSignature(settings, rawBody, headers));
  if (signatureConfigured && !signatureVerified) {
    throw codedError("飞驼可视推送签名校验失败。", 401, "FREIGHTOWER_WEBHOOK_SIGNATURE_INVALID");
  }

  const payload = parseWebhookJson(rawBody);
  const envelope = parseFreightowerWebhookEnvelope(payload);
  const OR = webhookTargetWhere(envelope);
  if (!OR.length) return { success: true, ignored: true, message: "推送缺少业务号、提单号或柜号，已忽略。" };
  const targets = await prisma.shipsgoTracking.findMany({
    where: { provider: FREIGHTOWER_PROVIDER, deletedAt: null, OR },
  });
  if (!targets.length) return { success: true, ignored: true, message: "本地未找到对应飞驼可视跟踪，已忽略。" };

  const replay = await claimWebhookReplay("freightower", freightowerWebhookFingerprint(rawBody));
  if (!replay.claimed) {
    if (replay.processed) return { success: true, ignored: true, message: "重复推送已忽略。" };
    throw codedError("相同推送正在处理中，请稍后重试。", 409, "WEBHOOK_DELIVERY_IN_PROGRESS");
  }
  const syncLeases: Array<{ trackingId: string; token: string }> = [];
  try {
    const now = new Date();
    const eligibleTargets = signatureVerified
      ? targets
      : targets.filter((target) => !target.lastCheckedAt || now.getTime() - target.lastCheckedAt.getTime() >= UNSIGNED_REQUERY_THROTTLE_MS);
    if (!eligibleTargets.length) {
      await completeWebhookReplayClaim(replay.key, "freightower");
      return { success: true, ignored: true, message: "相同物流刚刚完成回查，本次通知已合并。" };
    }
    const leasedTargets: ShipsgoTracking[] = [];
    for (const target of eligibleTargets) {
      const token = await claimFreightowerTrackingSyncLease(target.id);
      if (!token) continue;
      syncLeases.push({ trackingId: target.id, token });
      const current = await prisma.shipsgoTracking.findUnique({ where: { id: target.id } });
      if (current && !current.deletedAt) leasedTargets.push(current);
    }
    if (!leasedTargets.length) {
      await completeWebhookReplayClaim(replay.key, "freightower");
      return { success: true, ignored: true, message: "对应物流正在同步，本次推送已合并。" };
    }
    for (const target of leasedTargets) {
      const leaseToken = syncLeases.find((lease) => lease.trackingId === target.id)?.token;
      if (leaseToken) await reconcileFreightowerTrackingNotification(target.id, { leaseToken });
    }
    const prepared = await Promise.all(leasedTargets.map(async (target) => {
      const fullResponse = await freightowerApiRequest<unknown>(
        settings,
        "/application/v1/query",
        createFreightowerPayloadFromTracking(target, settings),
      );
      const authoritativePayload = signatureVerified && envelope.hasIncrementalResult
        ? mergeFreightowerWebhookPayload(fullResponse, payload)
        : fullResponse;
      const mapped = mapFreightowerShipmentPayload(authoritativePayload, settings);
      return { target, mapped };
    }));

    const savedIds = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const { target, mapped } of prepared) {
        const hasFreshTrackingData = mapped.syncStatus !== "SUBSCRIBED";
        const saved = await tx.shipsgoTracking.update({
          where: { id: target.id },
          data: {
            ...webhookTrackingPatch(mapped, target),
            lastCheckedAt: now,
            ...(hasFreshTrackingData ? { lastSyncedAt: now } : {}),
            lastSyncTime: now,
          },
        });
        if (hasFreshTrackingData && mapped.containerNumbers.length) {
          await tx.shipsgoTrackingContainer.deleteMany({ where: { trackingId: target.id } });
          await tx.shipsgoTrackingContainer.createMany({
            data: mapped.containerNumbers.map((containerNo) => ({ trackingId: target.id, containerNo })),
            skipDuplicates: true,
          });
        }
        if (hasFreshTrackingData && hasFreightowerTrackingNotificationChange(target, saved)) {
          await markFreightowerNotificationPending(
            tx,
            saved.id,
            FREIGHTOWER_NOTIFICATION_COMPREHENSIVE,
          );
        }
        ids.push(saved.id);
      }
      return ids;
    });
    const savedTrackings = (await Promise.all(savedIds.map((id) => loadShipsgoTrackingWithContainers(id))))
      .filter((tracking): tracking is NonNullable<typeof tracking> => Boolean(tracking));
    if (savedTrackings.length !== savedIds.length) throw codedError("飞驼可视推送同步保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
    await Promise.all(savedIds.map((id) => {
      const leaseToken = syncLeases.find((lease) => lease.trackingId === id)?.token;
      return leaseToken
        ? reconcileFreightowerTrackingNotification(id, { leaseToken })
        : Promise.resolve({ processed: false, skipped: "locked" as const });
    }));
    await completeWebhookReplayClaim(replay.key, "freightower");
    const serialized = savedTrackings.map((tracking) => serializeShipsgoTracking(tracking));
    return {
      success: true,
      mode: envelope.kind,
      signatureVerified,
      tracking: serialized[0],
      trackings: serialized,
      updatedCount: serialized.length,
    };
  } catch (error) {
    await releaseWebhookReplayClaim(replay.key);
    throw error;
  } finally {
    await Promise.all(syncLeases.map(({ trackingId, token }) => (
      releaseFreightowerTrackingSyncLease(trackingId, token).catch((error: unknown) => {
        console.error("freightower-webhook-sync-lease-release-failed", {
          trackingId,
          message: error instanceof Error ? error.message : "unknown",
        });
      })
    )));
  }
}
