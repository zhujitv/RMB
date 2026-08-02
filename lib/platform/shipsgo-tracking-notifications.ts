import crypto from "node:crypto";
import type { ShipsgoTracking } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { freightowerAlertText, latestFreightowerDumpingAlert } from "./freightower-alerts";
import { latestFreightowerPortEvent } from "./freightower-port-events";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { enabledAdminEmails, templateValue, uniqueEmails } from "./notification-helpers";
import { sendNotificationEmail } from "./notification-send";
import { enqueueWechatOfficialNotifications } from "./wechat-official-notifications";
import { FREIGHTOWER_PROVIDER } from "./shipsgo-tracking-utils";

const notificationUserSelect = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  approvalStatus: true,
} as const;

type NotificationUserCandidate = {
  email: string;
  isActive: boolean;
  approvalStatus: string;
} | null | undefined;

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.APP_BASE_URL || "https://www.nextwood.net").replace(/\/+$/, "");
}

function displayDateTime(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function activeApprovedEmails(users: NotificationUserCandidate[]) {
  return uniqueEmails(users
    .filter((user): user is NonNullable<NotificationUserCandidate> => Boolean(user?.isActive && user.approvalStatus === "APPROVED"))
    .map((user) => user.email));
}

function dumpingAlertEventKey(alert: NonNullable<ReturnType<typeof latestFreightowerDumpingAlert>>) {
  return crypto.createHash("sha256").update([
    alert.code,
    alert.category,
    alert.time,
    alert.containerNo,
    alert.description,
  ].join("\0")).digest("hex");
}

export function freightowerTrackingNotificationEventKey(tracking: ShipsgoTracking) {
  const dumpingAlert = latestFreightowerDumpingAlert(tracking.rawResponse ?? tracking.rawPayload);
  return dumpingAlert
    ? `${tracking.id}:dumping:${dumpingAlertEventKey(dumpingAlert)}`
    : [
        tracking.id,
        tracking.lastEventAt?.toISOString() || "",
        tracking.currentStatus || tracking.status || tracking.syncStatus,
        tracking.lastEvent || "",
        tracking.eta?.toISOString() || "",
        tracking.vesselName || "",
        tracking.voyage || "",
      ].join(":");
}

export function hasFreightowerTrackingNotificationChange(before: ShipsgoTracking, after: ShipsgoTracking) {
  return freightowerTrackingNotificationEventKey(before) !== freightowerTrackingNotificationEventKey(after);
}

export function freightowerPortTrackingNotificationEventKey(tracking: ShipsgoTracking) {
  const event = latestFreightowerPortEvent(tracking.portRawResponse);
  return event ? [
    tracking.id,
    event.eventCode,
    event.eventCategory,
    event.time,
    event.location,
    event.description,
    event.vesselName,
    event.voyage,
  ].join(":") : `${tracking.id}:port:none`;
}

export function hasFreightowerPortTrackingNotificationChange(before: ShipsgoTracking, after: ShipsgoTracking) {
  return freightowerPortTrackingNotificationEventKey(before) !== freightowerPortTrackingNotificationEventKey(after);
}

export async function notifyFreightowerTrackingUpdate(trackingId: string) {
  const tracking = await prisma.shipsgoTracking.findUnique({
    where: { id: trackingId },
    include: {
      order: {
        include: {
          customer: {
            select: {
              shortName: true,
              name: true,
            },
          },
          salesperson: { select: notificationUserSelect },
        },
      },
      containers: {
        select: { containerNo: true },
        orderBy: [{ containerNo: "asc" }],
      },
    },
  });
  if (!tracking || tracking.provider !== FREIGHTOWER_PROVIDER) return;

  const salespersonEmails = activeApprovedEmails([tracking.order.salesperson]);
  const adminEmails = await enabledAdminEmails();
  const finalRecipientEmails = uniqueEmails([adminEmails, salespersonEmails]);
  const admins = await prisma.user.findMany({
    where: { role: "管理员", isActive: true, approvalStatus: "APPROVED", deletedAt: null },
    select: { id: true },
  });
  const recipientUserIds = [
    ...admins.map((user) => user.id),
    tracking.order.salesperson?.isActive && tracking.order.salesperson.approvalStatus === "APPROVED"
      ? tracking.order.salesperson.id
      : "",
  ].filter(Boolean);
  if (!finalRecipientEmails.length && !recipientUserIds.length) return;
  const dumpingAlert = latestFreightowerDumpingAlert(tracking.rawResponse ?? tracking.rawPayload);
  const dumpingAlertText = freightowerAlertText(dumpingAlert);
  const portEvent = latestFreightowerPortEvent(tracking.portRawResponse);
  const portDumping = portEvent?.isDumpingWarning === true;

  const latestEventKey = freightowerTrackingNotificationEventKey(tracking);

  const orderNo = templateValue(tracking.order.orderNo);
  const blNo = templateValue(tracking.masterBlNo || tracking.order.blNo || tracking.bookingNumber);
  const statusText = templateValue(dumpingAlert || portDumping ? `甩柜预警 / ${tracking.currentStatus || tracking.status || tracking.syncStatus || "运输异常"}` : tracking.currentStatus || tracking.status || tracking.syncStatus);
  const eventText = templateValue(dumpingAlertText || portEvent?.description || tracking.lastEvent);
  const trackingUrl = `${appBaseUrl()}/tracking-map?trackingId=${encodeURIComponent(tracking.id)}`;

  await enqueueWechatOfficialNotifications({
    userIds: recipientUserIds,
    idempotencyKey: `freightower-tracking-update:${latestEventKey}`,
    title: dumpingAlert || portDumping ? "物流甩柜预警" : "物流状态更新",
    content: `订单：${orderNo}；提单：${blNo}；状态：${statusText}；节点：${eventText}；时间：${displayDateTime(dumpingAlert?.time || portEvent?.time || tracking.lastEventAt || tracking.lastSyncedAt || tracking.lastSyncTime)}`,
    url: trackingUrl,
    relatedEntityType: "shipsgo_tracking",
    relatedEntityId: tracking.id,
    relatedOrderId: tracking.orderId,
  }).catch((error: unknown) => {
    console.error("wechat-tracking-notification-enqueue-failed", {
      trackingId: tracking.id,
      message: error instanceof Error ? error.message : "unknown",
    });
  });

  if (finalRecipientEmails.length) await sendNotificationEmail({
    type: NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
    recipientEmails: finalRecipientEmails,
    variables: {
      orderNo,
      blNo,
      containerNo: templateValue(tracking.containerNumber || tracking.containers.map((item) => item.containerNo).filter(Boolean).join(", ")),
      statusText,
      eventText,
      eventTime: displayDateTime(dumpingAlert?.time || portEvent?.time || tracking.lastEventAt || tracking.lastSyncedAt || tracking.lastSyncTime),
      eta: displayDateTime(tracking.eta),
      vesselVoyage: templateValue([portEvent?.vesselName || tracking.vesselName, portEvent?.voyage || tracking.voyage].filter(Boolean).join(" / ")),
      trackingUrl,
    },
    relatedEntityType: "shipsgo_tracking",
    relatedEntityId: tracking.id,
    relatedOrderId: tracking.orderId,
    idempotencyKey: `freightower-tracking-update:${latestEventKey}`,
    context: {
      provider: FREIGHTOWER_PROVIDER,
      customerName: tracking.order.customer.shortName || tracking.order.customer.name || tracking.order.customerNameSnapshot,
      recipientSource: "admins_and_order_salesperson",
      adminRecipientCount: adminEmails.length,
      salespersonRecipientCount: salespersonEmails.length,
      dumpingWarning: dumpingAlertText || undefined,
      portEventSource: portEvent ? "freightower_china_port" : undefined,
    },
  });
}
