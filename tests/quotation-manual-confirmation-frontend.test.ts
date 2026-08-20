import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actionsSource = readFileSync("app/modules/quotations/quotation-detail-actions.tsx", "utf8");
const dialogSource = readFileSync("app/modules/quotations/quotation-manual-confirmation-dialog.tsx", "utf8");
const historySource = readFileSync("app/modules/quotations/quotation-delivery-history.tsx", "utf8");
const detailSource = readFileSync("app/modules/quotations/quotation-detail-drawer.tsx", "utf8");
const typesSource = readFileSync("app/modules/quotations/types.ts", "utf8");
const moduleViewSource = readFileSync("app/modules/quotations/quotations-module-view.tsx", "utf8");

test("manual confirmation is available on the current valid draft or sent version without a system delivery", () => {
  const rule = actionsSource.match(/const manualConfirmationAllowed = ([^;]+);/)?.[1] || "";
  assert.match(rule, /ready && !expired && canWrite && isCurrent/);
  assert.match(rule, /\["DRAFT", "SENT"\]\.includes/);
  assert.doesNotMatch(rule, /latestSentDelivery|canSendCustomerEmail/);
  assert.match(actionsSource, /setManualConfirmationOpen\(true\)[\s\S]*>手动确认<\/button>/);
  assert.match(actionsSource, /<QuotationManualConfirmationDialog/);
  assert.doesNotMatch(actionsSource, /QuotationResponseDialog|latestSentDelivery|setDecision\(/);
  assert.doesNotMatch(actionsSource, />客户接受<\/button>|>客户拒绝<\/button>/);
  assert.doesNotMatch(actionsSource, /当前版本没有系统邮件发送记录/);
  assert.match(moduleViewSource, /客户产品、历史价格、报价发送和客户确认统一在这里处理/);
});

test("manual confirmation submits the external channel, Shanghai date and optimistic version", () => {
  assert.match(dialogSource, /useState<ManualChannel>\("EXTERNAL_EMAIL"\)/);
  assert.match(dialogSource, /timeZone: "Asia\/Shanghai"/);
  assert.match(dialogSource, /<input type="date" value=\{confirmationDate\} max=\{today\} required/);
  assert.match(dialogSource, /JSON\.stringify\(\{ channel, confirmationDate, note: note\.trim\(\), expectedVersionNumber \}\)/);
  assert.match(dialogSource, /\/manual-confirmation`/);
  assert.match(dialogSource, /建议填写邮件主题、客户联系人等可追溯信息/);
});

test("quotation history merges manual decisions without duplicating system-email decisions", () => {
  assert.match(typesSource, /export type QuotationDecisionChannel = "SYSTEM_EMAIL" \| "EXTERNAL_EMAIL" \| "WECHAT" \| "WHATSAPP" \| "PHONE" \| "OTHER"/);
  assert.match(typesSource, /decisions\?: QuotationDecision\[\]/);
  assert.match(historySource, /decision\.channel !== "SYSTEM_EMAIL"/);
  assert.match(historySource, /系统邮件 ·/);
  assert.match(historySource, /手动登记 ·/);
  assert.doesNotMatch(historySource, /entry\.delivery\.responseStatus|entry\.delivery\.respondedAt/);
  assert.match(historySource, /客户已确认/);
  assert.match(historySource, /登记人：/);
  assert.match(historySource, /备注：/);
  assert.match(detailSource, /decisions=\{\(quotation\.decisions \|\| \[\]\)\.filter\(\(decision\) => decision\.quotationVersionId === version\?\.id\)\}/);
});
