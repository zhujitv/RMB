import type { Prisma, ShipsgoTracking } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { freightowerApiGet, freightowerApiRequest } from "./freightower-api";
import { mapFreightowerShipmentPayload } from "./freightower-mapping";
import { extractFreightowerPortTimeline } from "./freightower-port-events";
import { isPlainRecord, nonEmpty, type AppError } from "./shared-base-utils";
import type { ShipsgoSettings } from "./shipsgo-tracking-utils";

const PORT_PERMISSION_RETRY_MS = 24 * 60 * 60 * 1000;
const PORT_SUBSCRIBE_PATH = "/terminal/port/event/subscribe";
const PORT_QUERY_PATH = "/terminal/port/event/shipment";

function cleanPortCode(value: unknown) {
  const code = nonEmpty(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}[A-Z0-9]{3}$/.test(code) ? code : "";
}

function portBusinessNumber(tracking: ShipsgoTracking) {
  return nonEmpty(tracking.masterBlNo || tracking.bookingNumber || tracking.containerNumber)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 80);
}

function portContextFromTracking(tracking: ShipsgoTracking, settings: ShipsgoSettings) {
  if (tracking.portCode) {
    return { portCode: cleanPortCode(tracking.portCode), direction: tracking.portDirection === "I" ? "I" : "E" };
  }
  const mapped = mapFreightowerShipmentPayload(tracking.rawResponse ?? tracking.rawPayload, settings);
  const origin = cleanPortCode(mapped.originPortCode);
  const destination = cleanPortCode(mapped.destinationPortCode);
  const configured = settings.freightowerDefaultIsExport;
  const direction = configured === "I" || configured === "E"
    ? configured
    : origin.startsWith("CN") ? "E" : destination.startsWith("CN") ? "I" : "E";
  const portCode = cleanPortCode(
    direction === "I" ? destination : origin || settings.freightowerDefaultPortCode,
  );
  return { portCode, direction };
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

async function savePortFailure(trackingId: string, error: unknown) {
  const typed = error as AppError;
  const permissionRequired = typed.code === "FREIGHTOWER_PORT_PERMISSION_REQUIRED";
  return prisma.shipsgoTracking.update({
    where: { id: trackingId },
    data: {
      portTrackingStatus: permissionRequired ? "PERMISSION_REQUIRED" : "SYNC_FAILED",
      portTrackingMessage: permissionRequired
        ? "中国港区跟踪尚未授权，请联系飞驼开通该产品权限。"
        : String(typed.message || "中国港区跟踪同步失败。").slice(0, 500),
      portLastCheckedAt: new Date(),
    },
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
  try {
    let subscriptionId = nonEmpty(tracking.portSubscriptionId);
    if (!subscriptionId) {
      const subscribed = await freightowerApiRequest<unknown>(settings, PORT_SUBSCRIBE_PATH, {
        businessNumber,
        portCode,
        ieid: direction,
      });
      subscriptionId = subscriptionIdFromResponse(subscribed);
      if (!subscriptionId) throw new Error("飞驼港区订阅成功，但未返回 subscriptionId。");
      await prisma.shipsgoTracking.update({
        where: { id: tracking.id },
        data: {
          portTrackingStatus: "SUBSCRIBED",
          portTrackingMessage: "中国港区跟踪已订阅，正在读取港区节点。",
          portSubscriptionId: subscriptionId,
          portCode,
          portDirection: direction,
          portLastCheckedAt: new Date(),
        },
      });
    }
    const response = await freightowerApiGet<unknown>(settings, PORT_QUERY_PATH, { subscriptionId });
    const now = new Date();
    const eventCount = extractFreightowerPortTimeline(response).length;
    return prisma.shipsgoTracking.update({
      where: { id: tracking.id },
      data: {
        portTrackingStatus: eventCount ? "SYNCED" : "SUBSCRIBED",
        portTrackingMessage: eventCount ? `中国港区已同步 ${eventCount} 个节点。` : "中国港区已订阅，飞驼暂未返回港区节点。",
        portSubscriptionId: subscriptionId,
        portCode,
        portDirection: direction,
        portLastCheckedAt: now,
        portLastSyncedAt: now,
        portRawResponse: response as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    return savePortFailure(tracking.id, error);
  }
}
