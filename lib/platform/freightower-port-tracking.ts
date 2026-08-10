import type { Prisma, ShipsgoTracking } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { freightowerApiGet, freightowerApiRequest } from "./freightower-api";
import { mapFreightowerShipmentPayload } from "./freightower-mapping";
import {
  extractFreightowerPortTimeline,
  freightowerPortResponseState,
  mergeFreightowerPortResponses,
} from "./freightower-port-events";
import {
  normalizeFreightowerPortBusinessNumber,
  normalizeFreightowerPortCode,
  resolveFreightowerPortContext,
} from "./freightower-port-query";
import { codedError, isPlainRecord, nonEmpty, type AppError } from "./shared-base-utils";
import type { ShipsgoSettings } from "./shipsgo-tracking-utils";
import { hasFreightowerPortTrackingNotificationChange } from "./freightower-notification-events";
import {
  FREIGHTOWER_NOTIFICATION_PORT,
  markFreightowerNotificationPending,
} from "./freightower-notification-pending";
import { freightowerPortAlerts } from "./freightower-supplemental-alerts";

const PORT_PERMISSION_RETRY_MS = 24 * 60 * 60 * 1000;
const PORT_SUBSCRIBE_PATH = "/terminal/port/event/subscribe";
const PORT_QUERY_PATH = "/terminal/port/event/shipment";

function portBusinessNumber(tracking: ShipsgoTracking) {
  return normalizeFreightowerPortBusinessNumber(
    tracking.masterBlNo || tracking.bookingNumber || tracking.containerNumber,
  );
}

function portContextFromTracking(tracking: ShipsgoTracking, settings: ShipsgoSettings) {
  const mapped = mapFreightowerShipmentPayload(tracking.rawResponse ?? tracking.rawPayload, settings);
  return resolveFreightowerPortContext({
    storedPort: tracking.portCode,
    storedDirection: tracking.portDirection,
    origin: mapped.originPortCode,
    destination: mapped.destinationPortCode,
    defaultPort: settings.freightowerDefaultPortCode,
    defaultDirection: settings.freightowerDefaultIsExport,
  });
}

function subscriptionIdFromResponse(payload: unknown) {
  if (!isPlainRecord(payload)) return "";
  const data = payload.data;
  if (typeof data === "string" || typeof data === "number") return nonEmpty(data);
  if (!isPlainRecord(data)) return "";
  return nonEmpty(data.subscriptionId || data.id);
}

function shouldDeferPermissionRetry(tracking: ShipsgoTracking, force: boolean) {
  return !force
    && tracking.portTrackingStatus === "PERMISSION_REQUIRED"
    && tracking.portLastCheckedAt
    && Date.now() - tracking.portLastCheckedAt.getTime() < PORT_PERMISSION_RETRY_MS;
}

function samePortSubscriptionContext(
  tracking: ShipsgoTracking,
  businessNumber: string,
  portCode: string,
  direction: string,
) {
  const storedBusinessNumber = normalizeFreightowerPortBusinessNumber(tracking.portBusinessNumber);
  const storedPortMatches = normalizeFreightowerPortCode(tracking.portCode) === portCode;
  const storedDirectionMatches = nonEmpty(tracking.portDirection).toUpperCase() === direction;
  const legacySubscriptionContext = !storedBusinessNumber
    && Boolean(nonEmpty(tracking.portSubscriptionId))
    && storedPortMatches
    && storedDirectionMatches;
  return (
    storedBusinessNumber === businessNumber || legacySubscriptionContext
  ) && storedPortMatches && storedDirectionMatches;
}

function portRequestContextMatches(
  tracking: ShipsgoTracking,
  settings: ShipsgoSettings,
  expectedBusinessNumber: string,
  expectedPortCode: string,
  expectedDirection: string,
) {
  const latestContext = portContextFromTracking(tracking, settings);
  return portBusinessNumber(tracking) === expectedBusinessNumber
    && latestContext.portCode === expectedPortCode
    && latestContext.direction === expectedDirection;
}

async function savePortFailure(
  tracking: ShipsgoTracking,
  settings: ShipsgoSettings,
  error: unknown,
  expectedBusinessNumber: string,
  expectedPortCode: string,
  expectedDirection: string,
  requestStartedAt: Date,
  subscriptionId: string,
) {
  const typed = error as AppError;
  const permissionRequired = typed.code === "FREIGHTOWER_PORT_PERMISSION_REQUIRED";
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "shipsgo_trackings" WHERE "id" = ${tracking.id} FOR UPDATE
    `;
    if (!locked.length) return null;
    const latest = await tx.shipsgoTracking.findUnique({ where: { id: tracking.id } });
    if (!latest) return null;
    if (!portRequestContextMatches(
      latest,
      settings,
      expectedBusinessNumber,
      expectedPortCode,
      expectedDirection,
    )) return latest;
    if (latest.portLastCheckedAt
      && latest.portLastCheckedAt.getTime() >= requestStartedAt.getTime()) {
      return latest;
    }
    return tx.shipsgoTracking.update({
      where: { id: tracking.id },
      data: {
        portTrackingStatus: permissionRequired ? "PERMISSION_REQUIRED" : "SYNC_FAILED",
        portTrackingMessage: permissionRequired
          ? "中国港区跟踪尚未授权，请联系飞驼开通该产品权限。"
          : String(typed.message || "中国港区跟踪同步失败。").slice(0, 500),
        ...(subscriptionId ? {
          portSubscriptionId: subscriptionId,
          portBusinessNumber: expectedBusinessNumber,
          portCode: expectedPortCode,
          portDirection: expectedDirection,
        } : {}),
        portLastCheckedAt: new Date(),
      },
    });
  });
}

export async function syncFreightowerPortTracking(
  trackingId: string,
  settings: ShipsgoSettings,
  options: { force?: boolean } = {},
) {
  const tracking = await prisma.shipsgoTracking.findUnique({ where: { id: trackingId } });
  if (!tracking) return null;
  if (shouldDeferPermissionRetry(tracking, options.force === true)) return tracking;
  const businessNumber = portBusinessNumber(tracking);
  const { portCode, direction } = portContextFromTracking(tracking, settings);
  if (!businessNumber || !portCode || !portCode.startsWith("CN")) {
    return prisma.shipsgoTracking.update({
      where: { id: tracking.id },
      data: {
        portTrackingStatus: "WAITING_PORT_CODE",
        portTrackingMessage: businessNumber && portCode && !portCode.startsWith("CN")
          ? `中国港区接口不支持当前港口 ${portCode}。`
          : businessNumber
            ? "综合跟踪尚未返回有效中国港口代码，暂无法订阅港区节点。"
          : "缺少提单号、订舱号或柜号，暂无法订阅中国港区节点。",
        portCode: portCode || null,
        portDirection: direction,
        portLastCheckedAt: new Date(),
      },
    });
  }
  const requestStartedAt = new Date();
  const sameSubscriptionContext = samePortSubscriptionContext(
    tracking,
    businessNumber,
    portCode,
    direction,
  );
  let subscriptionId = sameSubscriptionContext ? nonEmpty(tracking.portSubscriptionId) : "";
  try {
    if (!subscriptionId) {
      const subscribed = await freightowerApiRequest<unknown>(settings, PORT_SUBSCRIBE_PATH, {
        businessNumber,
        portCode,
        ieid: direction,
      });
      subscriptionId = subscriptionIdFromResponse(subscribed);
      if (!subscriptionId) throw new Error("飞驼港区订阅成功，但未返回 subscriptionId。");
    }
    const response = await freightowerApiGet<unknown>(settings, PORT_QUERY_PATH, { subscriptionId });
    const responseState = freightowerPortResponseState(response);
    if (!responseState.accepted) {
      throw codedError(
        responseState.message || "飞驼中国港区跟踪返回失败。",
        400,
        "FREIGHTOWER_PORT_RESPONSE_ERROR",
      );
    }
    const responseEventCount = responseState.eventCount;
    return prisma.$transaction(async (tx) => {
      // Keep the provider request outside the transaction and serialize only the
      // final context check, merge, and write for this tracking row.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "shipsgo_trackings" WHERE "id" = ${tracking.id} FOR UPDATE
      `;
      if (!locked.length) return null;
      const latestTracking = await tx.shipsgoTracking.findUnique({ where: { id: tracking.id } });
      if (!latestTracking) return null;
      if (!portRequestContextMatches(
        latestTracking,
        settings,
        businessNumber,
        portCode,
        direction,
      )) return latestTracking;
      const latestSameSubscriptionContext = samePortSubscriptionContext(
        latestTracking,
        businessNumber,
        portCode,
        direction,
      );
      const previousEventCount = extractFreightowerPortTimeline(latestTracking.portRawResponse).length;
      const newerWriteCompleted = Boolean(
        latestTracking.portLastCheckedAt
        && latestTracking.portLastCheckedAt.getTime() >= requestStartedAt.getTime(),
      );
      const mergedResponse = latestSameSubscriptionContext
        ? newerWriteCompleted
          ? mergeFreightowerPortResponses(response, latestTracking.portRawResponse)
          : mergeFreightowerPortResponses(latestTracking.portRawResponse, response)
        : response;
      const eventCount = extractFreightowerPortTimeline(mergedResponse).length;
      const preservePreviousEvents = latestSameSubscriptionContext
        && responseEventCount === 0
        && previousEventCount > 0;
      const now = new Date();
      const saved = await tx.shipsgoTracking.update({
        where: { id: tracking.id },
        data: {
          portTrackingStatus: eventCount || preservePreviousEvents ? "SYNCED" : "SUBSCRIBED",
          portTrackingMessage: preservePreviousEvents
            ? `本次未返回新节点，已保留 ${previousEventCount} 个历史港区节点。`
            : eventCount
              ? `中国港区已同步 ${eventCount} 个节点。`
              : "中国港区已订阅，飞驼暂未返回港区节点。",
          portSubscriptionId: latestSameSubscriptionContext
            ? nonEmpty(latestTracking.portSubscriptionId) || subscriptionId
            : subscriptionId,
          portBusinessNumber: businessNumber,
          portCode,
          portDirection: direction,
          portLastCheckedAt: now,
          portLastSyncedAt: responseEventCount ? now : latestTracking.portLastSyncedAt,
          portRawResponse: mergedResponse as Prisma.InputJsonValue,
        },
      });
      const initialActiveWarning = latestTracking.portRawResponse == null
        && freightowerPortAlerts(extractFreightowerPortTimeline(saved.portRawResponse))
          .some((alert) => alert.active);
      if (initialActiveWarning || (
        latestTracking.portRawResponse != null
        && hasFreightowerPortTrackingNotificationChange(latestTracking, saved)
      )) {
        await markFreightowerNotificationPending(tx, tracking.id, FREIGHTOWER_NOTIFICATION_PORT);
      }
      return saved;
    });
  } catch (error) {
    return savePortFailure(
      tracking,
      settings,
      error,
      businessNumber,
      portCode,
      direction,
      requestStartedAt,
      subscriptionId,
    );
  }
}
