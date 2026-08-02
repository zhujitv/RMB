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
  BILINGUAL_TRACKING_NOTIFICATION_TYPES,
  logisticsEmailBodyIsBilingual,
  logisticsEmailSubjectIsEnglish,
} = await jiti.import<typeof import("../lib/platform/notification-definition-types.ts")>(
  "../lib/platform/notification-definition-types.ts",
);

test("tracking notification subjects are English and bodies are bilingual", () => {
  const tracking = NOTIFICATION_TYPE_DEFINITIONS.find(
    (definition) => definition.type === NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE,
  );
  assert.ok(tracking);
  assert.equal(logisticsEmailSubjectIsEnglish(tracking.subjectTemplate), true);
  assert.equal(logisticsEmailBodyIsBilingual(tracking.bodyTemplate), true);
  assert.match(tracking.subjectTemplate, /Shipment Tracking Update/);
  assert.match(tracking.bodyTemplate, /Shipment Information \/ 运输信息/);
  assert.match(tracking.bodyTemplate, /Container Rollover Alert/);

  const invoice = DEFAULT_LOGISTICS_INVOICE_NOTIFICATION_SETTINGS;
  assert.equal(logisticsEmailSubjectIsEnglish(invoice.singleSubjectTemplate), false);
  assert.equal(logisticsEmailSubjectIsEnglish(invoice.batchSubjectTemplate), false);
  assert.equal(logisticsEmailBodyIsBilingual(invoice.bodyTemplate), false);
  assert.match(invoice.singleSubjectTemplate, /物流费用审核通过/);
  assert.match(invoice.bodyTemplate, /待开票费用清单/);
  assert.match(invoice.invoiceRequirements, /发票金额需与系统审核通过的费用合计一致/);
});

test("English-subject policy only covers Freightower tracking notifications", () => {
  assert.deepEqual(
    [...BILINGUAL_TRACKING_NOTIFICATION_TYPES],
    [NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_UPDATE],
  );
});

test("logistics template persistence migrates old defaults and rejects regressions", () => {
  const helpers = readFileSync("lib/platform/notification-helpers.ts", "utf8");
  const settings = readFileSync("lib/platform/notification-settings.ts", "utf8");
  const rendering = readFileSync("lib/platform/notification-logistics-rendering.ts", "utf8");

  assert.match(helpers, /legacyLogisticsTemplateSyncData/);
  assert.match(helpers, /legacyFreightowerTemplateSyncData/);
  assert.match(helpers, /logisticsEmailBodyIsBilingual/);
  assert.match(settings, /LOGISTICS_EMAIL_SUBJECT_ENGLISH_REQUIRED/);
  assert.match(settings, /LOGISTICS_EMAIL_BODY_BILINGUAL_REQUIRED/);
  assert.doesNotMatch(settings, /LOGISTICS_BATCH_EMAIL_SUBJECT_ENGLISH_REQUIRED/);
  assert.match(rendering, /订单号/);
  assert.doesNotMatch(rendering, /Order No\. \/ 订单号/);
});
