import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { NOTIFICATION_TYPE_DEFINITIONS, NOTIFICATION_TYPES } = await jiti.import<
  typeof import("../lib/platform/notification-definitions.ts")
>("../lib/platform/notification-definitions.ts");
const {
  DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS,
} = await jiti.import<typeof import("../lib/platform/shared-settings-constants.ts")>(
  "../lib/platform/shared-settings-constants.ts",
);
const {
  CHINESE_TRACKING_NOTIFICATION_TYPES,
  ENGLISH_TRACKING_NOTIFICATION_TYPES,
  logisticsEmailBodyIsChinese,
  logisticsEmailBodyIsEnglish,
  logisticsEmailSubjectIsEnglish,
} = await jiti.import<typeof import("../lib/platform/notification-definition-types.ts")>(
  "../lib/platform/notification-definition-types.ts",
);
const {
  freightowerTrackingEmailAudiencePolicy,
} = await jiti.import<typeof import("../lib/platform/freightower-notification-audience.ts")>(
  "../lib/platform/freightower-notification-audience.ts",
);

test("tracking notifications use separate internal Chinese and customer English templates", () => {
  const internal = NOTIFICATION_TYPE_DEFINITIONS.find(
    (definition) => definition.type === NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
  );
  const customer = NOTIFICATION_TYPE_DEFINITIONS.find(
    (definition) => definition.type === NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE,
  );
  const portAlert = NOTIFICATION_TYPE_DEFINITIONS.find(
    (definition) => definition.type === NOTIFICATION_TYPES.FREIGHTOWER_PORT_ROLLOVER_ALERT,
  );
  const customsAlert = NOTIFICATION_TYPE_DEFINITIONS.find(
    (definition) => definition.type === NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT,
  );
  const portOperationAlert = NOTIFICATION_TYPE_DEFINITIONS.find(
    (definition) => definition.type === NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT,
  );
  assert.ok(internal);
  assert.ok(customer);
  assert.ok(portAlert);
  assert.ok(customsAlert);
  assert.ok(portOperationAlert);
  assert.equal(logisticsEmailBodyIsChinese(internal.bodyTemplate), true);
  assert.match(internal.subjectTemplate, /物流跟踪更新/);
  assert.doesNotMatch(internal.bodyTemplate, /Shipment Information|Container Rollover Alert/);
  assert.equal(logisticsEmailSubjectIsEnglish(customer.subjectTemplate), true);
  assert.equal(logisticsEmailBodyIsEnglish(customer.bodyTemplate), true);
  assert.match(customer.subjectTemplate, /Shipment Tracking Update/);
  assert.doesNotMatch(customer.bodyTemplate, /[\u3400-\u9fff]/u);
  assert.equal(logisticsEmailBodyIsChinese(portAlert.bodyTemplate), true);
  assert.equal(logisticsEmailBodyIsChinese(customsAlert.bodyTemplate), true);
  assert.equal(logisticsEmailBodyIsChinese(portOperationAlert.bodyTemplate), true);
  assert.match(portOperationAlert.bodyTemplate, /港区已开放|开港或截港时间变更/);
  assert.doesNotMatch(`${portAlert.bodyTemplate}${portOperationAlert.bodyTemplate}${customsAlert.bodyTemplate}`, /仅内部通知|不发送客户|禁止转发客户/);

  const invoice = DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS;
  assert.equal(logisticsEmailSubjectIsEnglish(invoice.singleSubjectTemplate), false);
  assert.equal(logisticsEmailSubjectIsEnglish(invoice.batchSubjectTemplate), false);
  assert.equal(logisticsEmailBodyIsChinese(invoice.bodyTemplate), true);
  assert.match(invoice.singleSubjectTemplate, /物流费用审核通过/);
  assert.match(invoice.bodyTemplate, /待开票费用清单/);
  assert.match(invoice.invoiceRequirements, /发票金额需与系统审核通过的费用合计一致/);
});

test("language policy assigns each Freightower audience its own template", () => {
  assert.deepEqual(
    [...CHINESE_TRACKING_NOTIFICATION_TYPES],
    [
      NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
      NOTIFICATION_TYPES.FREIGHTOWER_PORT_ROLLOVER_ALERT,
      NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT,
      NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT,
    ],
  );
  assert.deepEqual(
    [...ENGLISH_TRACKING_NOTIFICATION_TYPES],
    [NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE],
  );
});

test("port opening and schedule changes are internal-only while customs warnings retain priority", () => {
  assert.deepEqual(freightowerTrackingEmailAudiencePolicy({
    portRolloverChanged: false,
    customsChanged: false,
    portOperationChanged: true,
  }), {
    internalType: NOTIFICATION_TYPES.FREIGHTOWER_PORT_OPERATION_ALERT,
    customerAllowed: false,
  });
  assert.deepEqual(freightowerTrackingEmailAudiencePolicy({
    portRolloverChanged: false,
    customsChanged: true,
    portOperationChanged: true,
  }), {
    internalType: NOTIFICATION_TYPES.FREIGHTOWER_CUSTOMS_ALERT,
    customerAllowed: false,
  });
});

test("logistics template persistence migrates old defaults and rejects regressions", () => {
  const helpers = readFileSync("lib/platform/notification-helpers.ts", "utf8");
  const settings = readFileSync("lib/platform/notification-settings.ts", "utf8");
  const rendering = readFileSync("lib/platform/notification-logistics-rendering.ts", "utf8");
  const transport = readFileSync("lib/platform/notification-email-transport.ts", "utf8");
  const sender = readFileSync("lib/platform/notification-send.ts", "utf8");

  assert.match(helpers, /legacyLogisticsTemplateSyncData/);
  assert.match(helpers, /legacyFreightowerTemplateSyncData/);
  assert.match(helpers, /logisticsEmailBodyIsChinese/);
  assert.match(settings, /LOGISTICS_EMAIL_SUBJECT_ENGLISH_REQUIRED/);
  assert.match(settings, /LOGISTICS_EMAIL_BODY_ENGLISH_REQUIRED/);
  assert.match(settings, /LOGISTICS_EMAIL_BODY_CHINESE_REQUIRED/);
  assert.doesNotMatch(settings, /LOGISTICS_BATCH_EMAIL_SUBJECT_ENGLISH_REQUIRED/);
  assert.match(rendering, /订单号/);
  assert.doesNotMatch(rendering, /Order No\. \/ 订单号/);
  assert.match(transport, /html: html \|\| undefined/);
  assert.match(sender, /freightowerTrackingEmailHtml/);
});
