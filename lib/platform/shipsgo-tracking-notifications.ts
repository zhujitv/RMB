import { prisma } from "../prisma";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { enabledAdminEmails, templateValue, uniqueEmails } from "./notification-helpers";
import { sendNotificationEmail } from "./notification-send";
import { FREIGHTOWER_PROVIDER } from "./shipsgo-tracking-utils";

const notificationUserSelect = {
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
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function activeApprovedEmails(users: NotificationUserCandidate[]) {
  return uniqueEmails(users
    .filter((user): user is NonNullable<NotificationUserCandidate> => Boolean(user?.isActive && user.approvalStatus === "APPROVED"))
    .map((user) => user.email));
}

export async function notifyFreightowerTrackingUpdate(trackingId: string) {
  const tracking = await prisma.shipsgoTracking.findUnique({
    where: { id: trackingId },
    include: {
      order: {
        include: {
          customer: { select: { shortName: true, name: true } },
          salesperson: { select: notificationUserSelect },
          createdBy: { select: notificationUserSelect },
          updatedBy: { select: notificationUserSelect },
        },
      },
      createdBy: { select: notificationUserSelect },
      updatedBy: { select: notificationUserSelect },
      containers: {
        select: { containerNo: true },
        orderBy: [{ containerNo: "asc" }],
      },
    },
  });
  if (!tracking || tracking.provider !== FREIGHTOWER_PROVIDER) return;

  const recipientEmails = activeApprovedEmails([
    tracking.order.salesperson,
    tracking.order.createdBy,
    tracking.order.updatedBy,
    tracking.createdBy,
    tracking.updatedBy,
  ]);
  const finalRecipientEmails = recipientEmails.length ? recipientEmails : await enabledAdminEmails();
  if (!finalRecipientEmails.length) return;

  const latestEventKey = [
    tracking.id,
    tracking.lastEventAt?.toISOString() || "",
    tracking.currentStatus || tracking.status || tracking.syncStatus,
    tracking.lastEvent || "",
    tracking.eta?.toISOString() || "",
    tracking.vesselName || "",
    tracking.voyage || "",
  ].join(":");

  await sendNotificationEmail({
    type: NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
    recipientEmails: finalRecipientEmails,
    variables: {
      orderNo: templateValue(tracking.order.orderNo),
      blNo: templateValue(tracking.masterBlNo || tracking.order.blNo || tracking.bookingNumber),
      containerNo: templateValue(tracking.containerNumber || tracking.containers.map((item) => item.containerNo).filter(Boolean).join(", ")),
      statusText: templateValue(tracking.currentStatus || tracking.status || tracking.syncStatus),
      eventText: templateValue(tracking.lastEvent),
      eventTime: displayDateTime(tracking.lastEventAt || tracking.lastSyncedAt || tracking.lastSyncTime),
      eta: displayDateTime(tracking.eta),
      vesselVoyage: templateValue([tracking.vesselName, tracking.voyage].filter(Boolean).join(" / ")),
      trackingUrl: `${appBaseUrl()}/tracking-map?trackingId=${encodeURIComponent(tracking.id)}`,
    },
    relatedEntityType: "shipsgo_tracking",
    relatedEntityId: tracking.id,
    relatedOrderId: tracking.orderId,
    idempotencyKey: `freightower-tracking-update:${latestEventKey}`,
    context: {
      provider: FREIGHTOWER_PROVIDER,
      customerName: tracking.order.customer.shortName || tracking.order.customer.name || tracking.order.customerNameSnapshot,
      recipientSource: recipientEmails.length ? "order_operators" : "admin_fallback",
    },
  });
}
