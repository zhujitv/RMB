import type { Prisma, ShipsgoTracking } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { freightowerApiGet } from "./freightower-api";
import {
  extractFreightowerCustomsTimeline,
  freightowerCustomsResponseState,
  mergeFreightowerCustomsResponses,
} from "./freightower-customs-events";
import {
  normalizeFreightowerCustomsBillNumber,
  resolveFreightowerCustomsContext,
} from "./freightower-customs-query";
import { mapFreightowerShipmentPayload } from "./freightower-mapping";
import { codedError, nonEmpty, type AppError } from "./shared-base-utils";
import type { ShipsgoSettings } from "./shipsgo-tracking-utils";
import { hasFreightowerCustomsTrackingNotificationChange } from "./freightower-notification-events";
import {
  FREIGHTOWER_NOTIFICATION_CUSTOMS,
  markFreightowerNotificationPending,
} from "./freightower-notification-pending";

const CUSTOMS_QUERY_PATH = "/terminal/cn/customs/getBlnoDeclare";
const CUSTOMS_PERMISSION_RETRY_MS = 24 * 60 * 60 * 1000;

function customsBillNumber(tracking: ShipsgoTracking & { order?: { blNo?: string | null } | null }) {
  return normalizeFreightowerCustomsBillNumber(
    tracking.order?.blNo || tracking.masterBlNo || tracking.bookingNumber,
  );
}

function customsContext(tracking: ShipsgoTracking, settings: ShipsgoSettings) {
  const mapped = mapFreightowerShipmentPayload(tracking.rawResponse ?? tracking.rawPayload, settings);
  return resolveFreightowerCustomsContext({
    storedDirection: tracking.portDirection || tracking.customsDirection,
    storedPort: tracking.portCode,
    origin: mapped.originPortCode,
    destination: mapped.destinationPortCode,
    configuredDirection: settings.freightowerDefaultIsExport,
  });
}

function shouldDeferPermissionRetry(tracking: ShipsgoTracking, force: boolean) {
  return !force
    && tracking.customsTrackingStatus === "PERMISSION_REQUIRED"
    && tracking.customsLastCheckedAt
    && Date.now() - tracking.customsLastCheckedAt.getTime() < CUSTOMS_PERMISSION_RETRY_MS;
}

async function saveCustomsFailure(
  tracking: ShipsgoTracking & { order?: { blNo?: string | null } | null },
  settings: ShipsgoSettings,
  error: unknown,
  expectedBillNo: string,
  expectedDirection: string,
  requestStartedAt: Date,
) {
  const typed = error as AppError;
  const permissionRequired = typed.code === "FREIGHTOWER_CUSTOMS_PERMISSION_REQUIRED";
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "receivable_orders" WHERE "id" = ${tracking.orderId} FOR SHARE
    `;
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "shipsgo_trackings" WHERE "id" = ${tracking.id} FOR UPDATE
    `;
    if (!locked.length) return null;
    const latest = await tx.shipsgoTracking.findUnique({
      where: { id: tracking.id },
      include: { order: { select: { blNo: true } } },
    });
    if (!latest) return null;
    if (customsBillNumber(latest) !== expectedBillNo
      || customsContext(latest, settings).direction !== expectedDirection) {
      return latest;
    }
    if (latest.customsLastCheckedAt
      && latest.customsLastCheckedAt.getTime() >= requestStartedAt.getTime()) {
      return latest;
    }
    return tx.shipsgoTracking.update({
      where: { id: tracking.id },
      data: {
        customsTrackingStatus: permissionRequired ? "PERMISSION_REQUIRED" : "SYNC_FAILED",
        customsTrackingMessage: permissionRequired
          ? "中国海关提单号跟踪尚未授权，请联系飞驼开通该产品权限。"
          : String(typed.message || "中国海关跟踪同步失败。").slice(0, 500),
        customsLastCheckedAt: new Date(),
      },
    });
  });
}

export async function syncFreightowerCustomsTracking(
  trackingId: string,
  settings: ShipsgoSettings,
  options: { force?: boolean } = {},
) {
  const tracking = await prisma.shipsgoTracking.findUnique({
    where: { id: trackingId },
    include: { order: { select: { blNo: true } } },
  });
  if (!tracking) return null;
  if (shouldDeferPermissionRetry(tracking, options.force === true)) return tracking;
  const billNo = customsBillNumber(tracking);
  if (!settings.customsTrackingEnabled) return tracking;
  if (!settings.freightowerApiKey) {
    return prisma.shipsgoTracking.update({
      where: { id: tracking.id },
      data: {
        customsTrackingStatus: "CREDENTIAL_REQUIRED",
        customsTrackingMessage: "请在物流设置中填写飞驼 API Key。",
        customsLastCheckedAt: new Date(),
      },
    });
  }
  const { direction } = customsContext(tracking, settings);
  if (!billNo || !direction) {
    return prisma.shipsgoTracking.update({
      where: { id: tracking.id },
      data: {
        customsTrackingStatus: "WAITING_CONTEXT",
        customsTrackingMessage: !billNo
          ? "缺少提单号，暂无法查询中国海关节点。"
          : "暂未识别进出口方向，请在物流设置中选择进口或出口。",
        customsDirection: direction || null,
        customsLastCheckedAt: new Date(),
      },
    });
  }
  const requestStartedAt = new Date();
  try {
    const response = await freightowerApiGet<unknown>(settings, CUSTOMS_QUERY_PATH, {
      blno: billNo,
      ieid: direction,
    });
    const now = new Date();
    const responseState = freightowerCustomsResponseState(response);
    if (!responseState.accepted) {
      throw codedError(
        responseState.message || "飞驼中国海关跟踪返回失败。",
        400,
        "FREIGHTOWER_CUSTOMS_RESPONSE_ERROR",
      );
    }
    const responseEventCount = responseState.eventCount;
    return prisma.$transaction(async (tx) => {
      // Serialize the final merge/write for this tracking. The provider request stays
      // outside the transaction, so the row lock is held only for a short DB operation.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "receivable_orders" WHERE "id" = ${tracking.orderId} FOR SHARE
      `;
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "shipsgo_trackings" WHERE "id" = ${tracking.id} FOR UPDATE
      `;
      if (!locked.length) return null;
      const latestTracking = await tx.shipsgoTracking.findUnique({
        where: { id: tracking.id },
        include: { order: { select: { blNo: true } } },
      });
      if (!latestTracking) return null;
      const latestBillNo = customsBillNumber(latestTracking);
      const latestDirection = customsContext(latestTracking, settings).direction;
      // Do not save a response for an old bill/direction if the order or main
      // tracking context changed while the provider request was in flight.
      if (latestBillNo !== billNo || latestDirection !== direction) return latestTracking;
      const previousEventCount = extractFreightowerCustomsTimeline(latestTracking.customsRawResponse).length;
      const storedBillNumber = normalizeFreightowerCustomsBillNumber(latestTracking.customsBillNumber);
      const legacyCustomsContext = !storedBillNumber
        && previousEventCount > 0
        && nonEmpty(latestTracking.customsDirection).toUpperCase() === direction;
      const sameCustomsContext = (
        storedBillNumber === billNo || legacyCustomsContext
      ) && nonEmpty(latestTracking.customsDirection).toUpperCase() === direction;
      const mergedResponse = sameCustomsContext
        ? mergeFreightowerCustomsResponses(latestTracking.customsRawResponse, response)
        : response;
      const eventCount = extractFreightowerCustomsTimeline(mergedResponse).length;
      const preservePreviousEvents = sameCustomsContext && responseEventCount === 0 && previousEventCount > 0;
      const saved = await tx.shipsgoTracking.update({
        where: { id: tracking.id },
        data: {
          customsTrackingStatus: eventCount || preservePreviousEvents ? "SYNCED" : "SUBSCRIBED",
          customsTrackingMessage: preservePreviousEvents
            ? `本次未返回新节点，已保留 ${previousEventCount} 个历史海关节点。`
            : eventCount
              ? `中国海关已同步 ${eventCount} 个节点。`
              : responseState.message || "中国海关提单号跟踪已查询，飞驼暂未返回海关节点。",
          customsBillNumber: billNo,
          customsDirection: direction,
          customsLastCheckedAt: now,
          customsLastSyncedAt: responseEventCount ? now : latestTracking.customsLastSyncedAt,
          customsNotificationBaselineAt: latestTracking.customsNotificationBaselineAt || now,
          customsRawResponse: mergedResponse as Prisma.InputJsonValue,
        },
      });
      if (hasFreightowerCustomsTrackingNotificationChange(latestTracking, saved)) {
        await markFreightowerNotificationPending(
          tx,
          tracking.id,
          FREIGHTOWER_NOTIFICATION_CUSTOMS,
        );
      }
      return saved;
    });
  } catch (error) {
    return saveCustomsFailure(tracking, settings, error, billNo, direction, requestStartedAt);
  }
}
