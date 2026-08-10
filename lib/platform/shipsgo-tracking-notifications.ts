import { prisma } from "../prisma";
import { freightowerAlertText, latestFreightowerDumpingAlert } from "./freightower-alerts";
import { extractFreightowerCustomsTimeline, latestFreightowerCustomsEvent } from "./freightower-customs-events";
import { maskCustomsDeclarationNumbers } from "./freightower-customs-privacy";
import {
  freightowerNotificationSourceEvent,
  freightowerTrackingNotificationEventKey,
  type FreightowerNotificationChangeSource,
  type FreightowerNotificationEvent,
} from "./freightower-notification-events";
import { extractFreightowerPortTimeline, latestFreightowerPortEvent } from "./freightower-port-events";
import {
  freightowerCustomsEventHasActiveAlert,
  freightowerPortEventHasActiveAlert,
} from "./freightower-supplemental-alerts";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { enabledAdminEmails, templateValue, uniqueEmails } from "./notification-helpers";
import { sendNotificationEmail } from "./notification-send";
import { enqueueWechatOfficialNotifications } from "./wechat-official-notifications";
import { enqueueWechatMiniNotifications } from "./wechat-mini-notifications";
import { FREIGHTOWER_PROVIDER } from "./shipsgo-tracking-utils";

export {
  freightowerComprehensiveTrackingNotificationEventKey,
  freightowerCustomsTrackingNotificationEventKey,
  freightowerChangedNotificationSourceEvent,
  freightowerNotificationSourceEvent,
  freightowerPortTrackingNotificationEventKey,
  freightowerTrackingNotificationEventKey,
  freightowerSupplementalNotificationChange,
  freightowerSupplementalNotificationChanges,
  hasFreightowerCustomsTrackingNotificationChange,
  hasFreightowerPortTrackingNotificationChange,
  hasFreightowerTrackingNotificationChange,
} from "./freightower-notification-events";

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

export async function notifyFreightowerTrackingUpdate(
  trackingId: string,
  options: {
    changeSource?: FreightowerNotificationChangeSource;
    changeEvent?: FreightowerNotificationEvent | null;
    changeEvents?: Array<{
      source: Exclude<FreightowerNotificationChangeSource, "comprehensive">;
      event: FreightowerNotificationEvent | null;
    }>;
    comprehensiveChanged?: boolean;
    trackingEventKey?: string;
  } = {},
) {
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
  if (!finalRecipientEmails.length && !recipientUserIds.length) {
    return { deliveryKey: options.trackingEventKey || "", terminalSkipped: true };
  }
  const dumpingAlert = latestFreightowerDumpingAlert(tracking.rawResponse ?? tracking.rawPayload);
  const portEvent = latestFreightowerPortEvent(tracking.portRawResponse);
  const customsEvent = latestFreightowerCustomsEvent(tracking.customsRawResponse);
  const changedEvents = options.changeEvents?.filter((change) => change.event) || (
    options.changeEvent && options.changeSource && options.changeSource !== "comprehensive"
      ? [{ source: options.changeSource, event: options.changeEvent }]
      : []
  );
  const sourceEvent = changedEvents[0]?.event || options.changeEvent || freightowerNotificationSourceEvent(
    tracking,
    options.changeSource || "comprehensive",
  );
  const portTimeline = extractFreightowerPortTimeline(tracking.portRawResponse);
  const customsTimeline = extractFreightowerCustomsTimeline(tracking.customsRawResponse);
  const portDumping = changedEvents.some((change) => (
    change.source === "port"
    && change.event?.isDumpingWarning === true
    && freightowerPortEventHasActiveAlert(portTimeline, change.event)
  ));
  const customsWarning = changedEvents.some((change) => (
    change.source === "customs"
    && change.event?.isWarning === true
    && freightowerCustomsEventHasActiveAlert(customsTimeline, change.event)
  ));

  const trackingEventKey = options.trackingEventKey || freightowerTrackingNotificationEventKey(tracking);
  // The state fingerprint is the idempotency key. Do not append a caller-specific
  // source list: two overlapping syncs can observe the same final snapshot through
  // different paths and must still produce only one notification.
  const latestEventKey = trackingEventKey;
  const comprehensiveChanged = options.comprehensiveChanged
    ?? (options.changeSource === "comprehensive" && changedEvents.length === 0);
  const currentDumpingAlert = comprehensiveChanged ? dumpingAlert : null;
  const currentDumpingAlertText = freightowerAlertText(currentDumpingAlert);

  const orderNo = templateValue(tracking.order.orderNo);
  const blNo = templateValue(tracking.masterBlNo || tracking.order.blNo || tracking.bookingNumber);
  const statusText = templateValue(
    currentDumpingAlert || portDumping
      ? `甩柜预警 / ${tracking.currentStatus || tracking.status || tracking.syncStatus || "运输异常"}`
      : customsWarning
        ? "中国海关异常预警"
        : tracking.currentStatus || tracking.status || tracking.syncStatus,
  );
  const changedEventText = changedEvents.map((change) => {
    const description = change.source === "customs"
      ? maskCustomsDeclarationNumbers(change.event?.description || "")
      : change.event?.description || "";
    return changedEvents.length > 1
      ? `${change.source === "customs" ? "中国海关" : "中国港区"}：${description}`
      : description;
  }).filter(Boolean).join("；");
  const singleEventText = options.changeSource === "customs"
    ? maskCustomsDeclarationNumbers(sourceEvent?.description || "")
    : sourceEvent?.description || "";
  const eventText = templateValue(
    [currentDumpingAlertText, changedEventText].filter(Boolean).join("；")
      || singleEventText
      || tracking.lastEvent,
  );
  const eventTime = currentDumpingAlert?.time || sourceEvent?.time || tracking.lastEventAt || tracking.lastSyncedAt || tracking.lastSyncTime;
  const trackingUrl = `${appBaseUrl()}/tracking-map?trackingId=${encodeURIComponent(tracking.id)}`;

  const officialNotification = enqueueWechatOfficialNotifications({
    userIds: recipientUserIds,
    idempotencyKey: `freightower-tracking-update:${latestEventKey}`,
    title: currentDumpingAlert || portDumping ? "物流甩柜预警" : customsWarning ? "中国海关异常预警" : "物流状态更新",
    content: `订单：${orderNo}；提单：${blNo}；状态：${statusText}；节点：${eventText}；时间：${displayDateTime(eventTime)}`,
    url: trackingUrl,
    relatedEntityType: "shipsgo_tracking",
    relatedEntityId: tracking.id,
    relatedOrderId: tracking.orderId,
  });

  const miniNotification = enqueueWechatMiniNotifications({
    userIds: recipientUserIds,
    idempotencyKey: `freightower-tracking-update:${latestEventKey}`,
    orderNo,
    statusText,
    eventText,
    eventTimeText: displayDateTime(eventTime),
    page: `pages/tracking-detail/index?id=${encodeURIComponent(tracking.id)}`,
    relatedEntityType: "shipsgo_tracking",
    relatedEntityId: tracking.id,
    relatedOrderId: tracking.orderId,
  });

  const [officialDelivery, miniDelivery] = await Promise.all([officialNotification, miniNotification]);

  let emailDelivery: Awaited<ReturnType<typeof sendNotificationEmail>> | null = null;
  if (finalRecipientEmails.length) {
    try {
      emailDelivery = await sendNotificationEmail({
    type: NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
    recipientEmails: finalRecipientEmails,
    variables: {
      orderNo,
      blNo,
      containerNo: templateValue(tracking.containerNumber || tracking.containers.map((item) => item.containerNo).filter(Boolean).join(", ")),
      statusText,
      eventText,
      eventTime: displayDateTime(eventTime),
      eta: displayDateTime(tracking.eta),
      vesselVoyage: templateValue([
        sourceEvent?.vesselName || tracking.vesselName,
        sourceEvent?.voyage || tracking.voyage,
      ].filter(Boolean).join(" / ")),
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
      dumpingWarning: currentDumpingAlertText || undefined,
      portEventSource: portEvent ? "freightower_china_port" : undefined,
      customsEventSource: customsEvent ? "freightower_china_customs" : undefined,
      notificationChangeSource: options.changeSource || "comprehensive",
    },
      });
    } catch (error) {
      // The email sender persists a failed outbox before throwing. Once that row
      // exists the notification is durable and the cron retry owns delivery.
      const durableOutbox = await prisma.notificationOutbox.findUnique({
        where: { idempotencyKey: `freightower-tracking-update:${latestEventKey}` },
        select: { id: true, status: true },
      });
      if (!durableOutbox) throw error;
      emailDelivery = {
        sent: false,
        skipped: false,
        outboxId: durableOutbox.id,
        error: error instanceof Error ? error.message : "邮件已进入失败重试队列",
      };
    }
  }
  return {
    deliveryKey: latestEventKey,
    terminalSkipped: false,
    email: emailDelivery,
    official: officialDelivery,
    mini: miniDelivery,
  };
}
