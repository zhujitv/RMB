import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  deriveFactoryDispatchSmsState,
  FACTORY_DISPATCH_SMS_MAX_ATTEMPTS,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-dispatch-sms-status.ts")
>("../lib/platform/factory-purchase-order-dispatch-sms-status.ts");

const read = (path: string) => readFileSync(path, "utf8");
const schema = [
  read("prisma/models/parties.prisma"),
  read("prisma/models/sales-executions.prisma"),
  read("prisma/models/reference-notifications.prisma"),
].join("\n");
const migration = read("prisma/migrations/20260816113000_factory_dispatch_sms_outbox/migration.sql");
const dispatch = read("lib/platform/sales-execution-dispatch.ts");
const outbox = read("lib/platform/factory-purchase-order-dispatch-sms-outbox.ts");
const keys = read("lib/platform/factory-purchase-order-dispatch-sms-keys.ts");
const claim = read("lib/platform/factory-purchase-order-dispatch-sms-claim.ts");
const processor = read("lib/platform/factory-purchase-order-dispatch-sms-notifications.ts");
const status = read("lib/platform/factory-purchase-order-dispatch-sms-status.ts");
const retirement = read("lib/platform/factory-purchase-order-dispatch-sms-retirement.ts");
const reassignment = read("lib/platform/factory-purchase-order-reassignment.ts");
const reassignmentDelivery = read("lib/platform/factory-purchase-order-reassignment-delivery.ts");
const response = read("lib/platform/factory-purchase-order-response-core.ts");
const executionService = read("lib/platform/sales-execution-service.ts");
const voidNotifications = read("lib/platform/sales-execution-void-notifications.ts");
const cron = read("app/api/cron/notification-outbox/route.ts");
const dispatchRoute = read("app/api/sales-executions/[id]/dispatch/route.ts");
const reassignRoute = read("app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/reassign/route.ts");
const orderList = read("app/modules/sales-execution/purchase-order-draft-list.tsx");

test("SMS dispatch schema is additive and keeps email rows backward compatible", () => {
  assert.match(schema, /dispatchSmsEnabled\s+Boolean\s+@default\(false\)/);
  assert.match(schema, /dispatchSmsPhone\s+String\?/);
  assert.match(schema, /dispatchSmsStatus\s+String\?/);
  assert.match(schema, /dispatchRecipientPhones\s+Json\?/);
  assert.match(schema, /channel\s+String\s+@default\("EMAIL"\)/);
  assert.match(schema, /recipientPhones\s+Json\?/);
  assert.match(migration, /ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'EMAIL'/);
  assert.match(migration, /ADD COLUMN "dispatch_sms_enabled" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /'SUBMITTED'[\s\S]*'RETRYING'[\s\S]*'UNKNOWN'/);
});

test("SMS queue is per purchase-order version and normalized phone without business leakage", () => {
  assert.match(keys, /factory-po-dispatch-sms:\$\{purchaseOrderId\}:v\$\{dispatchVersionNumber\}/);
  assert.match(outbox, /recipientEmails: \[\]/);
  assert.match(outbox, /recipientPhones: \[phone\]/);
  assert.match(outbox, /channel: FACTORY_DISPATCH_SMS_CHANNEL/);
  assert.match(outbox, /context: \{\s*poNo: order\.poNo,\s*dispatchVersionNumber,\s*\}/);
  assert.doesNotMatch(outbox, /productName|purchaseUnitPrice|customerName|actionUrl/);
  assert.match(processor, /templateParams: \[context\.poNo\]/);
  assert.doesNotMatch(processor, /templateParams: \[[^\]]*,/);
});

test("initial dispatch and rejected-order reassignment queue SMS atomically, then send after commit", () => {
  const transaction = dispatch.match(/transactionResult = await prisma\.\$transaction[\s\S]*?isolationLevel/)?.[0] || "";
  assert.match(transaction, /queueFactoryPurchaseOrderDispatchSmsOutbox/);
  assert.doesNotMatch(transaction, /sendTencentCloudSms|processFactoryPurchaseOrderDispatchSmsOutbox/);
  assert.match(dispatch, /Promise\.allSettled\([\s\S]*processFactoryPurchaseOrderDispatchSmsOutbox/);
  assert.match(dispatch, /processFactoryPurchaseOrderDispatchSmsOutbox\(\{\s*limit: 1/);
  assert.match(reassignment, /queueFactoryPurchaseOrderDispatchSmsOutbox/);
  assert.match(reassignmentDelivery, /Promise\.allSettled/);
  assert.match(reassignmentDelivery, /processFactoryPurchaseOrderDispatchSmsOutbox\(\{\s*limit: 1/);
});

test("configuration read failures create durable delayed tasks instead of hiding as disabled", () => {
  assert.match(outbox, /let settingsReadFailed = false/);
  assert.match(outbox, /settingsReadFailed \|\| !configurationReady/);
  assert.match(outbox, /status: configurationProblem \? "failed" : "queued"/);
  assert.match(outbox, /scheduledAt: new Date\(Date\.now\(\) \+ 30 \* 60 \* 1000\)/);
  assert.match(outbox, /dispatchSmsStatus: configurationProblem \? "CONFIG_ERROR" : "NOT_SENT"/);
  assert.match(claim, /settingsReadFailed[\s\S]*status: "failed"[\s\S]*scheduledAt:/);
  assert.doesNotMatch(claim, /settings\.templateId === context\.templateId/);
});

test("permanent failures, safe retries and unknown outcomes are mutually exclusive", () => {
  assert.match(processor, /outboxStatus: retryable \? "failed" : "terminal_failed"/);
  assert.match(processor, /result\.outcomeUnknown[\s\S]*outboxStatus: "unknown"/);
  assert.match(status, /status: \{ in: \["queued", "failed"\] \}/);
  assert.doesNotMatch(status, /status: \{ in: \[[^\]]*terminal_failed/);
  assert.match(status, /row\.status === "terminal_failed"/);
  assert.match(status, /row\.status === "failed" && row\.attempts < FACTORY_DISPATCH_SMS_MAX_ATTEMPTS/);
  assert.match(processor, /failed: results\.filter\([\s\S]*!\("unknown" in result && result\.unknown\)/);
  assert.match(processor, /unknown: results\.filter/);
});

test("SMS state derivation keeps retries distinct from terminal and unknown outcomes", () => {
  const row = (statusValue: string, attempts: number, lastError = "provider error") => ({
    status: statusValue,
    attempts,
    lastError,
    sentAt: statusValue === "sent" ? new Date("2026-08-16T01:00:00Z") : null,
    updatedAt: new Date("2026-08-16T01:00:00Z"),
  });
  assert.equal(deriveFactoryDispatchSmsState([row("failed", 1)], 1).status, "RETRYING");
  assert.equal(
    deriveFactoryDispatchSmsState([
      row("failed", FACTORY_DISPATCH_SMS_MAX_ATTEMPTS),
    ], 1).status,
    "FAILED",
  );
  assert.equal(deriveFactoryDispatchSmsState([row("terminal_failed", 1)], 1).status, "FAILED");
  assert.equal(deriveFactoryDispatchSmsState([row("unknown", 1)], 1).status, "UNKNOWN");
  assert.equal(deriveFactoryDispatchSmsState([row("sent", 1)], 1).status, "SUBMITTED");
});

test("reject, void and reassignment cancel only safe SMS tasks and preserve unknown audit facts", () => {
  assert.match(retirement, /status: "sending", updatedAt: \{ gt: staleBefore \}/);
  assert.match(retirement, /status: "sending", updatedAt: \{ lte: staleBefore \}/);
  assert.match(retirement, /data: \{ status: "unknown"/);
  assert.match(retirement, /dispatchSmsStatus: "UNKNOWN"/);
  assert.match(retirement, /existingUnknownOrders[\s\S]*dispatchSmsStatus: "UNKNOWN"/);
  assert.match(retirement, /status: \{ in: \["queued", "failed", "pending"\] \}/);
  assert.match(response, /retireFactoryPurchaseOrderDispatchSms/);
  assert.match(executionService, /retireVoidedSalesExecutionNotifications/);
  assert.match(voidNotifications, /retireFactoryPurchaseOrderDispatchSms/);
  assert.match(reassignment, /retireRejectedPurchaseOrderNotifications/);
  assert.doesNotMatch(response, /dispatchSmsStatus: before\.dispatchSmsStatus/);
});

test("cron isolates SMS failures and UI says submitted rather than delivered", () => {
  assert.match(cron, /processFactoryPurchaseOrderDispatchSmsOutbox\(\{ limit: 10 \}\)\.catch/);
  assert.match(cron, /processFactoryPurchaseOrderDispatchOutbox\(\{ limit: 20 \}\)\.catch/);
  assert.match(dispatchRoute, /腾讯云已受理/);
  assert.match(dispatchRoute, /发送结果未知[\s\S]*已停止自动重试/);
  assert.match(reassignRoute, /sms\.unknown[\s\S]*发送结果未知[\s\S]*已停止自动重试/);
  assert.match(orderList, /dispatchSmsStatus === "SUBMITTED"[\s\S]*腾讯云已受理/);
  assert.doesNotMatch(orderList, /短信已送达|腾讯云已送达/);
});
