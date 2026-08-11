import { prisma } from "../prisma";
import { freightowerAlertText, latestFreightowerDumpingAlert } from "./freightower-alerts";
import { extractFreightowerCustomsTimeline, latestFreightowerCustomsEvent } from "./freightower-customs-events";
import { freightowerTrackingChangedEventTexts } from "./freightower-notification-copy";
import {
  freightowerNotificationSourceEvent,
  freightowerTrackingNotificationEventKey,
  type FreightowerNotificationChangeSource,
  type FreightowerNotificationEvent,
} from "./freightower-notification-events";
import { freightowerPortOperationNotification } from "./freightower-port-notifications";
import { extractFreightowerPortTimeline, latestFreightowerPortEvent } from "./freightower-port-events";
import {
  freightowerCustomsEventHasActiveAlert,
  freightowerPortEventHasActiveAlert,
} from "./freightower-supplemental-alerts";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { enabledAdminEmails, templateValue, uniqueEmails } from "./notification-helpers";
import { freightowerCustomerEventText, freightowerCustomerStatusText } from "./freightower-tracking-email";
import {
  freightowerTrackingEventTimeText,
  freightowerTrackingEmailAudiencePolicy,
  freightowerTrackingEmailVariableSets,
  sendDurableFreightowerTrackingEmail,
} from "./freightower-tracking-email-notification";
import { serializeShipsgoTracking } from "./shipsgo-tracking-serializer";
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
              contactEmail: true,
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
  const internalRecipientEmails = uniqueEmails([adminEmails, salespersonEmails]);
  const internalRecipientSet = new Set(internalRecipientEmails);
  const customerRecipientEmails = uniqueEmails([tracking.order.customer.contactEmail])
    .filter((email) => !internalRecipientSet.has(email));
  if (!internalRecipientEmails.length && !customerRecipientEmails.length) {
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
  const customsChanged = options.changeSource === "customs"
    || changedEvents.some((change) => change.source === "customs");
  const portOperation = freightowerPortOperationNotification(changedEvents, portTimeline);

  const trackingEventKey = options.trackingEventKey || freightowerTrackingNotificationEventKey(tracking);
  const latestEventKey = trackingEventKey;
  const comprehensiveChanged = options.comprehensiveChanged
    ?? (options.changeSource === "comprehensive" && changedEvents.length === 0);
  const currentDumpingAlert = comprehensiveChanged ? dumpingAlert : null;
  const currentDumpingAlertText = freightowerAlertText(currentDumpingAlert);
  const portRolloverChanged = Boolean(currentDumpingAlert)
    || changedEvents.some((change) => change.source === "port" && change.event?.isDumpingWarning === true)
    || (options.changeSource === "port" && sourceEvent?.isDumpingWarning === true);

  const orderNo = templateValue(tracking.order.orderNo);
  const blNo = templateValue(tracking.masterBlNo || tracking.order.blNo || tracking.bookingNumber);
  const statusText = templateValue(
    currentDumpingAlert || portDumping
      ? `甩柜预警 / ${tracking.currentStatus || tracking.status || tracking.syncStatus || "运输异常"}`
      : customsWarning
        ? "中国海关异常预警"
        : portOperation.title || tracking.currentStatus || tracking.status || tracking.syncStatus,
  );
  const eventTexts = freightowerTrackingChangedEventTexts({
    changedEvents,
    changeSource: options.changeSource,
    sourceEvent,
  });
  const eventText = templateValue(
    [currentDumpingAlertText, eventTexts.internalChangedText].filter(Boolean).join("；")
      || eventTexts.singleInternalText
      || tracking.lastEvent,
  );
  const eventTime = currentDumpingAlert?.time
    || (sourceEvent ? sourceEvent.time : tracking.lastEventAt || tracking.lastSyncedAt || tracking.lastSyncTime);
  const warning = Boolean(currentDumpingAlert || portDumping || customsWarning);
  const eventTextEn = currentDumpingAlert
    ? "Container rollover alert"
    : eventTexts.customerChangedText || freightowerCustomerEventText(sourceEvent);
  const statusTextEn = freightowerCustomerStatusText(statusText, warning);
  const containerNumbers = tracking.containers.map((item) => item.containerNo).filter(Boolean);
  const currentEta = tracking.predictedDischargeDate || tracking.eta || tracking.dateOfDischarge;
  const { internalVariables, customerVariables } = freightowerTrackingEmailVariableSets({
    trackingId: tracking.id,
    orderNo,
    blNo,
    containerNumber: tracking.containerNumber,
    containerNumbers,
    carrier: tracking.carrierName || tracking.carrierScac,
    origin: tracking.originName,
    destination: tracking.destinationName,
    originalEta: tracking.dateOfDischarge,
    currentEta,
    loadingDate: tracking.dateOfLoading,
    vesselName: sourceEvent?.vesselName || tracking.vesselName,
    voyage: sourceEvent?.voyage || tracking.voyage,
    statusText,
    statusTextEn,
    eventText,
    eventTextEn,
    eventTime,
    warning,
    timeline: serializeShipsgoTracking(tracking).timeline,
  });
  const commonContext = {
    provider: FREIGHTOWER_PROVIDER,
    customerName: tracking.order.customer.shortName || tracking.order.customer.name || tracking.order.customerNameSnapshot,
    dumpingWarning: currentDumpingAlertText || undefined,
    portEventSource: portEvent ? "freightower_china_port" : undefined,
    customsEventSource: customsEvent ? "freightower_china_customs" : undefined,
    notificationChangeSource: options.changeSource || "comprehensive",
  };
  const emailAudience = freightowerTrackingEmailAudiencePolicy({
    portRolloverChanged,
    customsChanged,
    portOperationChanged: portOperation.changed,
  });
  const [emailDelivery, customerEmailDelivery] = await Promise.all([
    sendDurableFreightowerTrackingEmail({
      type: emailAudience.internalType,
      recipientEmails: internalRecipientEmails,
      audience: "internal",
      variables: internalVariables,
      trackingEventKey: latestEventKey,
      trackingId: tracking.id,
      orderId: tracking.orderId,
      context: {
        ...commonContext,
        recipientSource: "admins_and_order_salesperson",
        adminRecipientCount: adminEmails.length,
        salespersonRecipientCount: salespersonEmails.length,
        audience: "internal",
      },
    }),
    sendDurableFreightowerTrackingEmail({
      type: NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE,
      recipientEmails: emailAudience.customerAllowed ? customerRecipientEmails : [],
      audience: "customer",
      variables: customerVariables,
      trackingEventKey: latestEventKey,
      trackingId: tracking.id,
      orderId: tracking.orderId,
      context: {
        ...commonContext,
        recipientSource: "customer_contact_email",
        customerRecipientCount: customerRecipientEmails.length,
        audience: "customer",
      },
    }),
  ]);
  return {
    deliveryKey: latestEventKey,
    terminalSkipped: false,
    email: emailDelivery,
    customerEmail: customerEmailDelivery,
  };
}
