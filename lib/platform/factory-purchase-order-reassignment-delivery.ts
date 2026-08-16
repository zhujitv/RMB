import { processFactoryPurchaseOrderDispatchOutbox } from "./factory-purchase-order-dispatch-notifications";
import { processFactoryPurchaseOrderDispatchSmsOutbox } from "./factory-purchase-order-dispatch-sms-notifications";

export type ReplacementPurchaseOrderDispatchResult = {
  replacementPurchaseOrderId: string;
  queued: number;
  missingRecipient: number;
  queuedSms: number;
  missingSmsRecipient: number;
  disabledSms: number;
  smsConfigurationError: number;
};

export async function processReplacementPurchaseOrderNotifications(input: {
  purchaseOrderId: string;
  queuedEmail: number;
  queuedSms: number;
}) {
  const [emailResult, smsResult] = await Promise.allSettled([
    processFactoryPurchaseOrderDispatchOutbox({
      limit: 20,
      purchaseOrderIds: [input.purchaseOrderId],
    }),
    processFactoryPurchaseOrderDispatchSmsOutbox({
      limit: 1,
      purchaseOrderIds: [input.purchaseOrderId],
    }),
  ]);
  return {
    email: emailResult.status === "fulfilled"
      ? emailResult.value
      : { scanned: 0, sent: 0, failed: 0, skipped: 0, queued: input.queuedEmail, results: [] },
    sms: smsResult.status === "fulfilled"
      ? smsResult.value
      : { scanned: 0, submitted: 0, failed: 0, unknown: 0, skipped: 0, queued: input.queuedSms, results: [] },
  };
}

export function summarizeReplacementPurchaseOrderNotifications(
  deliveries: Awaited<ReturnType<typeof processReplacementPurchaseOrderNotifications>>,
  counts: {
    missingEmail: number;
    missingSms: number;
    disabledSms: number;
    smsConfigurationError: number;
  },
) {
  return {
    notificationSummary: {
      total: 1,
      sent: deliveries.email.sent,
      failed: deliveries.email.failed,
      queued: deliveries.email.queued,
      missingRecipient: counts.missingEmail,
    },
    smsNotificationSummary: {
      total: 1,
      submitted: deliveries.sms.submitted,
      failed: deliveries.sms.failed,
      unknown: deliveries.sms.unknown,
      queued: deliveries.sms.queued,
      missingRecipient: counts.missingSms,
      disabled: counts.disabledSms,
      configurationError: counts.smsConfigurationError,
    },
  };
}
