import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { businessOrderNeedsPaymentRegistration } from "../app/modules/quotations/quotation-customer-business-values.ts";

const businessRecordsSource = readFileSync("app/modules/quotations/quotation-customer-business-records.tsx", "utf8");
const crmStyles = readFileSync("app/modules/quotations/quotation-crm-workspace.module.css", "utf8");

test("customer business records respond to their panel width instead of the viewport", () => {
  assert.match(
    businessRecordsSource,
    /className=\{`\$\{styles\.crmPanel\} \$\{styles\.fullWidthPanel\} \$\{styles\.businessPanel\}`\}/,
  );
  assert.match(
    crmStyles,
    /\.businessPanel\s*\{[^}]*container-type:\s*inline-size;/,
  );
  assert.match(
    crmStyles,
    /@container\s*\(max-width:\s*1120px\)\s*\{[\s\S]*?\.businessGrid\s*\{[^}]*grid-template-columns:\s*1fr;/,
  );
});

test("payment business rows use three columns because they render three fields", () => {
  assert.match(
    businessRecordsSource,
    /className=\{`\$\{styles\.businessRow\} \$\{styles\.paymentBusinessRow\}`\}/,
  );
  assert.match(
    crmStyles,
    /\.paymentBusinessRow\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(140px,\s*auto\)\s+minmax\(150px,\s*auto\);/,
  );
});

test("payment registration is hidden only after full collection", () => {
  assert.match(
    businessRecordsSource,
    /canRegisterPayments\s*&&\s*businessOrderNeedsPaymentRegistration\(order\)/,
  );
  assert.equal(businessOrderNeedsPaymentRegistration({ summary: { arrivedPaymentsCny: 100, arrivedOutstandingCny: 10 } }), true);
  assert.equal(businessOrderNeedsPaymentRegistration({ status: "部分收款", summary: { arrivedPaymentsCny: 100, arrivedOutstandingCny: 10 } }), true);
  assert.equal(businessOrderNeedsPaymentRegistration({ summary: { arrivedOutstandingCny: 0 } }), false);
  assert.equal(businessOrderNeedsPaymentRegistration({ summary: { outstandingCny: -0.01 } }), false);
  assert.equal(businessOrderNeedsPaymentRegistration({ status: "已收齐" }), false);
  assert.equal(businessOrderNeedsPaymentRegistration({ status: "多收款" }), false);
  assert.equal(businessOrderNeedsPaymentRegistration({ status: "已发货", summary: { arrivedPaymentsCny: 0, arrivedOutstandingCny: 10 } }), true);
});
