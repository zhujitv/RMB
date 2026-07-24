import crypto from "node:crypto";
import { prisma } from "../prisma";
import { codedError, nonEmpty } from "./shared-base-utils";
import { timingSafeEqualText } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import {
  assertFreightowerOceanEnabled,
  mapFreightowerShipmentPayload,
  trackingDataFromFreightowerMappedShipment,
  verifyFreightowerWebhookSignature,
} from "./freightower-tracking";
import {
  extractShipmentPayload,
  mapShipsgoShipmentPayload,
  recursiveShipmentId,
  serializeShipsgoTracking,
  textAt,
  trackingDataFromMappedShipment,
} from "./shipsgo-tracking-mapping";
import {
  FREIGHTOWER_PROVIDER,
  SHIPSGO_PROVIDER,
  safeJsonParse,
} from "./shipsgo-tracking-utils";
import {
  loadShipsgoTrackingWithContainers,
  replaceShipsgoTrackingContainers,
} from "./shipsgo-tracking-service-shared";
import {
  claimWebhookReplay,
  completeWebhookReplayClaim,
  releaseWebhookReplayClaim,
} from "./webhook-replay-guard";
import { notifyFreightowerTrackingUpdate } from "./shipsgo-tracking-notifications";

function webhookReplayFingerprint(provider: string, rawBody: string, signature: unknown, headers?: Headers) {
  const providerHeaders = provider === FREIGHTOWER_PROVIDER && headers
    ? [
        headers.get("x-ft-timestamp") || "",
        headers.get("x-ft-nonce") || "",
        headers.get("x-ft-client") || "",
        headers.get("x-ft-signature") || "",
      ].join("\0")
    : String(signature || "");
  return crypto.createHash("sha256").update(`${provider}\0${providerHeaders}\0${rawBody}`).digest("hex");
}

export async function handleShipsgoWebhook(rawBody: string, signature: unknown, headers?: Headers) {
  const settings = await getShipsgoIntegrationSettings();
  if (settings.activeProvider === FREIGHTOWER_PROVIDER) {
    assertFreightowerOceanEnabled(settings);
    if (!settings.webhookEnabled) throw codedError("飞驼可视推送未启用。", 400, "FREIGHTOWER_WEBHOOK_DISABLED");
    if (!settings.freightowerWebhookSecret) {
      throw codedError("飞驼可视推送 Access Secret 未配置。", 503, "FREIGHTOWER_WEBHOOK_SECRET_REQUIRED");
    }
    if (!headers || !verifyFreightowerWebhookSignature(settings, rawBody, headers)) {
      throw codedError("飞驼可视推送签名校验失败。", 401, "FREIGHTOWER_WEBHOOK_SIGNATURE_INVALID");
    }
    const payload = safeJsonParse(rawBody);
    const mapped = mapFreightowerShipmentPayload(payload, settings);
    const targetShipmentId = mapped.shipsgoShipmentId;
    const targetWhere: Array<{ shipsgoShipmentId?: string; masterBlNo?: string; bookingNumber?: string; containerNumber?: string }> = [];
    if (targetShipmentId) targetWhere.push({ shipsgoShipmentId: targetShipmentId });
    if (mapped.masterBlNo) targetWhere.push({ masterBlNo: mapped.masterBlNo });
    if (mapped.bookingNumber) targetWhere.push({ bookingNumber: mapped.bookingNumber });
    if (mapped.containerNumber) targetWhere.push({ containerNumber: mapped.containerNumber });
    const before = await prisma.shipsgoTracking.findFirst({
      where: {
        provider: FREIGHTOWER_PROVIDER,
        deletedAt: null,
        OR: targetWhere,
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (!before) return { success: true, ignored: true, message: "本地未找到对应飞驼可视跟踪，已忽略。" };
    const replay = await claimWebhookReplay(
      "freightower",
      webhookReplayFingerprint(FREIGHTOWER_PROVIDER, rawBody, signature, headers),
    );
    if (!replay.claimed) {
      if (replay.processed) return { success: true, ignored: true, message: "重复推送已忽略。" };
      throw codedError("相同推送正在处理中，请稍后重试。", 409, "WEBHOOK_DELIVERY_IN_PROGRESS");
    }
    try {
      const trackingData = trackingDataFromFreightowerMappedShipment(mapped);
      const now = new Date();
      const savedBase = await prisma.shipsgoTracking.update({
        where: { id: before.id },
        data: {
          ...trackingData,
          shipsgoShipmentId: mapped.shipsgoShipmentId || targetShipmentId,
          masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
          containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
          eta: mapped.eta,
          currentStatus: mapped.currentStatus,
          syncStatus: "WEBHOOK_SYNCED",
          syncMessage: "",
          lastCheckedAt: now,
          lastSyncedAt: now,
          lastSyncTime: now,
        },
      });
      await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
      const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
      if (!saved) throw codedError("飞驼可视推送同步保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
      await runNonCriticalTask(
        "飞驼可视跟踪推送邮件通知",
        () => notifyFreightowerTrackingUpdate(saved.id),
        { context: { provider: FREIGHTOWER_PROVIDER, trackingId: saved.id, orderId: saved.orderId } },
      );
      await completeWebhookReplayClaim(replay.key, "freightower");
      return { success: true, tracking: serializeShipsgoTracking(saved) };
    } catch (error) {
      await releaseWebhookReplayClaim(replay.key);
      throw error;
    }
  }

  if (!settings.enabled || !settings.webhookEnabled) {
    throw codedError("大掌櫃 Webhook 未启用。", 400, "SHIPSGO_WEBHOOK_DISABLED");
  }
  if (!settings.webhookSecret) {
    throw codedError("大掌櫃 Webhook Secret 未配置。", 400, "SHIPSGO_WEBHOOK_SECRET_REQUIRED");
  }
  const expected = crypto.createHmac("sha256", settings.webhookSecret).update(rawBody).digest("hex");
  if (!timingSafeEqualText(nonEmpty(signature), expected)) {
    throw codedError("大掌櫃 Webhook 签名校验失败。", 401, "SHIPSGO_WEBHOOK_SIGNATURE_INVALID");
  }
  const payload = safeJsonParse(rawBody);
  const shipmentPayload = extractShipmentPayload(payload);
  const shipmentId = textAt(shipmentPayload, "id") || recursiveShipmentId(payload);
  if (!shipmentId) {
    return { success: true, ignored: true, message: "未找到 Shipment ID，已忽略。" };
  }
  const before = await prisma.shipsgoTracking.findFirst({
    where: { provider: SHIPSGO_PROVIDER, shipsgoShipmentId: shipmentId, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (!before) return { success: true, ignored: true, message: "本地未找到对应大掌櫃跟踪，已忽略。" };
  const replay = await claimWebhookReplay(
    "shipsgo",
    webhookReplayFingerprint(SHIPSGO_PROVIDER, rawBody, signature, headers),
  );
  if (!replay.claimed) {
    if (replay.processed) return { success: true, ignored: true, message: "重复推送已忽略。" };
    throw codedError("相同推送正在处理中，请稍后重试。", 409, "WEBHOOK_DELIVERY_IN_PROGRESS");
  }
  try {
    const mapped = mapShipsgoShipmentPayload(shipmentPayload);
    const trackingData = trackingDataFromMappedShipment(mapped);
    const now = new Date();
    const savedBase = await prisma.shipsgoTracking.update({
      where: { id: before.id },
      data: {
        ...trackingData,
        shipsgoShipmentId: mapped.shipsgoShipmentId || shipmentId,
        masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
        containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
        eta: mapped.eta,
        currentStatus: mapped.currentStatus,
        syncStatus: "WEBHOOK_SYNCED",
        syncMessage: "",
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastSyncTime: now,
      },
    });
    await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
    const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
    if (!saved) throw codedError("大掌櫃 Webhook 同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
    await completeWebhookReplayClaim(replay.key, "shipsgo");
    return { success: true, tracking: serializeShipsgoTracking(saved) };
  } catch (error) {
    await releaseWebhookReplayClaim(replay.key);
    throw error;
  }
}
