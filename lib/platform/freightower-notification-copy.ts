import { maskCustomsDeclarationNumbers } from "./freightower-customs-privacy";
import type {
  FreightowerNotificationChangeSource,
  FreightowerNotificationEvent,
} from "./freightower-notification-events";
import { freightowerCustomerEventText } from "./freightower-tracking-email";

type ChangedEvent = {
  source: Exclude<FreightowerNotificationChangeSource, "comprehensive">;
  event: FreightowerNotificationEvent | null;
};

export function freightowerTrackingChangedEventTexts(input: {
  changedEvents: ChangedEvent[];
  changeSource?: FreightowerNotificationChangeSource;
  sourceEvent: FreightowerNotificationEvent | null;
}) {
  const internalChangedText = input.changedEvents.map((change) => {
    const description = change.source === "customs"
      ? maskCustomsDeclarationNumbers(change.event?.description || "")
      : change.event?.description || "";
    return input.changedEvents.length > 1
      ? `${change.source === "customs" ? "中国海关" : "中国港区"}：${description}`
      : description;
  }).filter(Boolean).join("；");
  const singleInternalText = input.changeSource === "customs"
    ? maskCustomsDeclarationNumbers(input.sourceEvent?.description || "")
    : input.sourceEvent?.description || "";
  const customerChangedText = input.changedEvents.map((change) => {
    const description = freightowerCustomerEventText(change.event);
    return input.changedEvents.length > 1
      ? `${change.source === "customs" ? "China Customs" : "China Port"}: ${description}`
      : description;
  }).join("; ");
  return { internalChangedText, singleInternalText, customerChangedText };
}
