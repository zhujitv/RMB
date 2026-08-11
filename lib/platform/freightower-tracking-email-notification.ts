import { prisma } from "../prisma";
import { templateValue } from "./notification-helpers";
import { sendNotificationEmail } from "./notification-send";
export { freightowerTrackingEmailAudiencePolicy } from "./freightower-notification-audience";

type DateValue = Date | string | null | undefined;

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.APP_BASE_URL || "https://www.nextwood.net")
    .replace(/\/+$/, "");
}

export function freightowerTrackingNotificationUrl(trackingId: string) {
  return `${appBaseUrl()}/tracking-map?trackingId=${encodeURIComponent(trackingId)}`;
}

function displayDateTime(value: DateValue, locale: "zh" | "en") {
  const pending = locale === "zh" ? "待飞驼更新" : "Pending provider update";
  if (!value) return pending;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return pending;
  const formatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  if (locale === "en") return formatter.format(date);
  const parts = formatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export function freightowerTrackingEventTimeText(value: DateValue) {
  return displayDateTime(value, "zh");
}

function displayDate(value: DateValue, locale: "zh" | "en") {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function wholeDaysBetween(start: DateValue, end: DateValue) {
  if (!start || !end) return null;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  return Math.max(0, Math.ceil((endTime - startTime) / 86_400_000));
}

function durationText(days: number | null, locale: "zh" | "en") {
  if (days == null) return "-";
  return locale === "zh" ? `${days} 天` : `${days} day${days === 1 ? "" : "s"}`;
}

function shipmentProgress(start: DateValue, end: DateValue) {
  if (!start || !end) return 58;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return 58;
  return Math.max(4, Math.min(96, Math.round(((Date.now() - startTime) / (endTime - startTime)) * 100)));
}

export function freightowerTrackingEmailVariableSets(input: {
  trackingId: string;
  orderNo: string;
  blNo: string;
  containerNumber?: string | null;
  containerNumbers: string[];
  carrier?: string | null;
  origin?: string | null;
  destination?: string | null;
  originalEta: DateValue;
  currentEta: DateValue;
  loadingDate: DateValue;
  vesselName?: string | null;
  voyage?: string | null;
  statusText: string;
  statusTextEn: string;
  eventText: string;
  eventTextEn: string;
  eventTime: DateValue;
  warning: boolean;
  timeline: unknown;
}) {
  const transitDays = wholeDaysBetween(input.loadingDate, input.currentEta);
  const remainingDays = wholeDaysBetween(new Date(), input.currentEta);
  const sharedVariables = {
    orderNo: input.orderNo,
    blNo: input.blNo,
    containerNo: templateValue(input.containerNumber || input.containerNumbers.join(", ")),
    containerCount: Math.max(input.containerNumbers.length, input.containerNumber ? 1 : 0),
    carrier: templateValue(input.carrier),
    origin: templateValue(input.origin),
    destination: templateValue(input.destination),
    firstEta: displayDate(input.originalEta, "zh"),
    firstEtaEn: displayDate(input.originalEta, "en"),
    eta: displayDate(input.currentEta, "zh"),
    etaEn: displayDate(input.currentEta, "en"),
    transitText: durationText(transitDays, "zh"),
    transitTextEn: durationText(transitDays, "en"),
    remainingText: durationText(remainingDays, "zh"),
    remainingTextEn: durationText(remainingDays, "en"),
    progressPercent: shipmentProgress(input.loadingDate, input.currentEta),
    updateDate: displayDate(new Date(), "zh"),
    updateDateEn: displayDate(new Date(), "en"),
    vesselVoyage: templateValue([input.vesselName, input.voyage].filter(Boolean).join(" / ")),
    trackingUrl: freightowerTrackingNotificationUrl(input.trackingId),
    warning: input.warning,
    timeline: input.timeline,
    statusTextEn: input.statusTextEn,
    eventTextEn: input.eventTextEn,
    eventTimeEn: displayDateTime(input.eventTime, "en"),
  };
  return {
    internalVariables: {
      ...sharedVariables,
      statusText: input.statusText,
      eventText: input.eventText,
      eventTime: displayDateTime(input.eventTime, "zh"),
    },
    customerVariables: {
      ...sharedVariables,
      statusText: input.statusTextEn,
      eventText: input.eventTextEn,
      eventTime: displayDateTime(input.eventTime, "en"),
    },
  };
}

export async function sendDurableFreightowerTrackingEmail(input: {
  type: string;
  recipientEmails: string[];
  audience: "internal" | "customer";
  variables: Record<string, unknown>;
  context: Record<string, unknown>;
  trackingEventKey: string;
  trackingId: string;
  orderId: string;
}) {
  if (!input.recipientEmails.length) return null;
  const idempotencyKey = `freightower-tracking-update:${input.trackingEventKey}:${input.audience}`;
  try {
    return await sendNotificationEmail({
      type: input.type,
      recipientEmails: input.recipientEmails,
      variables: input.variables,
      relatedEntityType: "shipsgo_tracking",
      relatedEntityId: input.trackingId,
      relatedOrderId: input.orderId,
      idempotencyKey,
      context: input.context,
      // Customer messages are intentionally isolated from legacy template CCs.
      ignoreTemplateCc: input.audience === "customer",
    });
  } catch (error) {
    const durableOutbox = await prisma.notificationOutbox.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true },
    });
    if (!durableOutbox) throw error;
    return {
      sent: false,
      skipped: false,
      outboxId: durableOutbox.id,
      error: error instanceof Error ? error.message : "邮件已进入失败重试队列",
    };
  }
}
