import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import {
  customerProductDescription,
  duplicateQuotationItemAfter,
  hasCurrentManualQuotationAcceptance,
  quotationDraftFromRow,
  quotationItemDescription,
  quotationNeedsSellerSnapshotRepair,
} from "../app/modules/quotations/types.ts";
import { visibleProductDescriptionParts } from "../app/modules/quotations/quotation-product-description-values.ts";

const jiti = createJiti(import.meta.url);
const { quotationValidityState } = await jiti.import<typeof import("../app/modules/quotations/quotation-expiry.ts")>(
  "../app/modules/quotations/quotation-expiry.ts",
);
const { buildCustomerInsights } = await jiti.import<typeof import("../app/modules/quotations/quotation-crm-insights.ts")>(
  "../app/modules/quotations/quotation-crm-insights.ts",
);

const editorSource = readFileSync("app/modules/quotations/quotation-items-editor.tsx", "utf8");
const actionsSource = readFileSync("app/modules/quotations/quotation-item-actions.tsx", "utf8");
const formSource = readFileSync("app/modules/quotations/quotation-form-panel.tsx", "utf8");
const businessEntitySelectSource = readFileSync("app/modules/quotations/quotation-business-entity-select.tsx", "utf8");
const detailSource = readFileSync("app/modules/quotations/quotation-detail-drawer.tsx", "utf8");
const detailActionsSource = readFileSync("app/modules/quotations/quotation-detail-actions.tsx", "utf8");
const emailDialogSource = readFileSync("app/modules/quotations/quotation-email-dialog.tsx", "utf8");
const quotesModuleSource = readFileSync("app/modules/QuotesModule.tsx", "utf8");
const quotationsViewSource = readFileSync("app/modules/quotations/quotations-module-view.tsx", "utf8");
const quotationCrmSource = readFileSync("app/modules/quotations/quotation-crm-workspace.tsx", "utf8");
const quotationCustomerDetailSource = readFileSync("app/modules/quotations/quotation-customer-detail.tsx", "utf8");
const quotationCustomerProductsSource = readFileSync("app/modules/quotations/quotation-customer-products-editor.tsx", "utf8");
const quotationCustomerContactsSource = readFileSync("app/modules/quotations/quotation-customer-contacts.tsx", "utf8");
const quotationCustomerFollowUpsSource = readFileSync("app/modules/quotations/quotation-customer-follow-ups.tsx", "utf8");
const quotationCustomerBusinessSource = readFileSync("app/modules/quotations/quotation-customer-business-records.tsx", "utf8");
const customerCrmServiceSource = readFileSync("lib/platform/customer-crm.ts", "utf8");
const customerBusinessRouteSource = readFileSync("app/api/customer-business-records/route.ts", "utf8");
const customerFollowUpsMigration = readFileSync("prisma/migrations/20260821120000_customer_follow_ups/migration.sql", "utf8");

test("only the current version internal decision unlocks quotation conversion", () => {
  const base = {
    id: "quotation-1",
    status: "ACCEPTED" as const,
    currentVersion: { id: "version-2", versionNumber: 2 },
  };
  assert.equal(hasCurrentManualQuotationAcceptance({
    ...base,
    decisions: [{
      id: "decision-1",
      quotationVersionId: "version-2",
      decision: "ACCEPTED",
      channel: "EXTERNAL_EMAIL",
    }],
  }), true);
  assert.equal(hasCurrentManualQuotationAcceptance({
    ...base,
    decisions: [{
      id: "legacy-decision",
      quotationVersionId: "version-2",
      decision: "ACCEPTED",
      channel: "SYSTEM_EMAIL",
    }],
  }), false);
  assert.equal(hasCurrentManualQuotationAcceptance({
    ...base,
    decisions: [{
      id: "old-version-decision",
      quotationVersionId: "version-1",
      decision: "ACCEPTED",
      channel: "OTHER",
    }],
  }), false);
});

test("product descriptions combine names and specifications into one natural field", () => {
  assert.equal(customerProductDescription({
    id: "product-1",
    name: "Universal panel WPC",
    specification: "24*140*2900 mm",
  }), "Universal panel WPC (24*140*2900 mm)");
  assert.equal(customerProductDescription({
    id: "product-2",
    name: "Universal panel WPC",
    specification: "(24*140*2900 mm)",
  }), "Universal panel WPC (24*140*2900 mm)");
  assert.equal(customerProductDescription({
    id: "product-3",
    name: "Universal panel WPC 24*140*2900 mm",
    specification: "24*140*2900 mm",
  }), "Universal panel WPC 24*140*2900 mm");
});

test("legacy quotation specifications remain hidden and are merged for display", () => {
  const draft = quotationDraftFromRow({
    id: "quote-1",
    customerId: "customer-1",
    currentVersion: {
      currency: "USD",
      items: [{
        id: "item-1",
        name: "Universal panel WPC",
        specification: "24*140*2900 mm",
        unit: "PCS",
        quantity: "10",
        unitPrice: "12.5",
      }],
    },
  });
  assert.equal(draft.items[0]?.description, "Universal panel WPC");
  assert.equal(draft.items[0]?.specification, "24*140*2900 mm");
  assert.equal(quotationItemDescription(draft.items[0]), "Universal panel WPC (24*140*2900 mm)");
});

test("combined product input normalizes split and already-combined storage consistently", () => {
  const visible = "Universal panel WPC (24*140*2900 mm)";
  const expected = { description: "Universal panel WPC", specification: "24*140*2900 mm" };
  assert.deepEqual(visibleProductDescriptionParts(visible, "24*140*2900 mm"), expected);
  assert.deepEqual(visibleProductDescriptionParts(visible, ""), expected);
  assert.equal(quotationItemDescription({ ...expected, key: "split" }), visible);
  assert.equal(quotationItemDescription({ description: visible, specification: "24*140*2900 mm", key: "combined" }), visible);
});

test("draft and sent quotations expire by their Shanghai calendar date", () => {
  const now = new Date("2026-08-09T08:00:00+08:00");
  assert.equal(quotationValidityState({ id: "draft", status: "DRAFT", currentVersion: { validUntil: "2026-08-08" } }, now).expired, true);
  assert.equal(quotationValidityState({ id: "sent", status: "SENT", currentVersion: { validUntil: "2026-08-09" } }, now).expired, false);
  assert.equal(quotationValidityState({ id: "accepted", status: "ACCEPTED", currentVersion: { validUntil: "2026-08-08" } }, now).expired, false);
});

test("duplicating a quotation row inserts an independent copy immediately below it", () => {
  const original = {
    key: "line-1",
    id: "saved-item-1",
    customerProductId: "product-1",
    description: "Universal panel WPC",
    specification: "24*140*2900 mm",
    unit: "PCS",
    quantity: "20",
    unitPrice: "12.5",
    unitPriceSource: "history" as const,
    remark: "Brown",
  };
  const next = {
    ...original,
    key: "line-2",
    id: "saved-item-2",
    description: "Second product",
  };

  const result = duplicateQuotationItemAfter([original, next], original.key);

  assert.equal(result.length, 3);
  assert.strictEqual(result[0], original);
  assert.strictEqual(result[2], next);
  assert.notEqual(result[1]?.key, original.key);
  assert.equal(result[1]?.id, undefined);
  assert.deepEqual(
    { ...result[1], key: original.key, id: original.id },
    original,
  );
});

test("existing quotations can save a new version without requiring content edits", () => {
  assert.equal(quotationNeedsSellerSnapshotRepair({
    id: "legacy-quote",
    currentVersion: {
      businessEntityNameSnapshot: "",
      sellerNameEnSnapshot: "",
      documentTemplateVersion: "PI_V1",
      sellerSnapshotReady: false,
    },
  }), true);
  assert.equal(quotationNeedsSellerSnapshotRepair({
    id: "ready-quote",
    currentVersion: {
      businessEntityNameSnapshot: "NEXTWOOD CO., LTD.",
      sellerNameEnSnapshot: "NEXTWOOD CO., LTD.",
      documentTemplateVersion: "PI_V5",
      sellerSnapshotReady: true,
    },
  }), false);
  assert.equal(quotationNeedsSellerSnapshotRepair({
    id: "previous-template-v4-quote",
    currentVersion: {
      businessEntityNameSnapshot: "NEXTWOOD CO., LTD.",
      sellerNameEnSnapshot: "NEXTWOOD CO., LTD.",
      documentTemplateVersion: "PI_V4",
      sellerSnapshotReady: true,
    },
  }), true);
  assert.equal(quotationNeedsSellerSnapshotRepair({
    id: "previous-template-quote",
    currentVersion: {
      businessEntityNameSnapshot: "NEXTWOOD CO., LTD.",
      sellerNameEnSnapshot: "NEXTWOOD CO., LTD.",
      documentTemplateVersion: "PI_V3",
      sellerSnapshotReady: true,
    },
  }), true);
  assert.equal(quotationNeedsSellerSnapshotRepair({
    id: "old-template-quote",
    currentVersion: {
      businessEntityNameSnapshot: "NEXTWOOD CO., LTD.",
      sellerNameEnSnapshot: "NEXTWOOD CO., LTD.",
      documentTemplateVersion: "PI_V1",
      sellerSnapshotReady: true,
    },
  }), true);
  assert.match(formSource, /disabled=\{saving \|\| \(!initialQuotation\?\.id && !dirty && !sellerSnapshotRepairRequired\)\}/);
  assert.doesNotMatch(formSource, /disabled=\{saving \|\| \(!dirty && !sellerSnapshotRepairRequired\)\}/);
  assert.match(formSource, /更新卖方资料并生成新版本/);
});

test("quotation editor uses inline product suggestions and clears hidden linkage on manual edits", () => {
  assert.doesNotMatch(editorSource, /客户产品复用/);
  assert.doesNotMatch(editorSource, /aria-label="规格"/);
  assert.doesNotMatch(editorSource, /<datalist/);
  assert.match(editorSource, /role="combobox"/);
  assert.match(editorSource, /role="listbox"/);
  assert.match(editorSource, /data-product-id=\{product\.id\}/);
  assert.match(editorSource, /customerProductSearchText\(product\)/);
  assert.match(editorSource, /物料编码 \$\{product\.materialCode\}/);
  assert.match(editorSource, /visibleProductDescriptionParts\(event\.target\.value, item\.specification\)/);
  assert.match(editorSource, /customerProductId: ""[\s\S]*\.\.\.normalized/);
  assert.match(editorSource, /event\.key === "ArrowDown"/);
  assert.match(editorSource, /event\.key === "ArrowUp"/);
  assert.match(editorSource, /event\.key === "Enter"/);
  assert.match(editorSource, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}[\s\S]*onClick=\{\(\) => chooseProduct\(product\)\}/);
  assert.match(editorSource, /duplicateQuotationItemAfter\(items, item\.key\)/);
  assert.match(actionsSource, /复制当前报价行并插入下一行/);
});

test("quotation form has no tax field or hidden tax payload", () => {
  assert.doesNotMatch(formSource, /taxAmount/);
  assert.doesNotMatch(formSource, />\s*Tax\s*</i);
  assert.doesNotMatch(detailSource, />\s*Tax\s*</i);
});

test("new quotations require an explicit business entity selection", () => {
  assert.equal(quotationDraftFromRow(null).businessEntityId, "");
  assert.doesNotMatch(formSource, /defaultQuotationBusinessEntityId/);
  assert.match(formSource, /if \(!form\.businessEntityId\) return "请选择业务主体"/);
  assert.match(businessEntitySelectSource, /<option value="">请选择业务主体<\/option>/);
  assert.match(businessEntitySelectSource, /required=\{!locked\}/);
});

test("customer-product lookups and retained prices are scoped to the quotation currency", () => {
  assert.match(formSource, /currency: form\.currency\.trim\(\)\.toUpperCase\(\)/);
  assert.match(formSource, /\[form\.customerId, form\.currency\]/);
  assert.match(editorSource, /productCurrency !== requestedCurrency/);
  assert.match(editorSource, /manualPrice = item\.unitPriceSource === "manual" \? item\.unitPrice : ""/);
  assert.match(editorSource, /unitPrice: retainedPrice \|\| manualPrice/);
  assert.match(formSource, /function selectCurrency[\s\S]*unitPrice: "", unitPriceSource: ""/);
  assert.match(formSource, /function selectCustomer[\s\S]*customerProductId: ""[\s\S]*unitPrice: ""/);
});

test("quotation details display legacy name and specification in one column", () => {
  assert.match(detailSource, /产品描述（含规格）/);
  assert.match(detailSource, /quotationItemDescription\(item\)/);
  assert.doesNotMatch(detailSource, /<th>规格<\/th>/);
  assert.match(detailSource, /colSpan=\{6\}/);
});

test("quotation actions wait for full detail and keep only send plus manual confirmation", () => {
  assert.match(detailSource, /Array\.isArray\(quotation\.deliveries\)[\s\S]*Array\.isArray\(quotation\.versions\)/);
  assert.match(detailActionsSource, /canSendCustomerEmail[\s\S]*sendAllowed/);
  assert.match(quotesModuleSource, /canWritePermission\(currentUser, permissions, "customerCommunication"/);
  assert.match(detailActionsSource, />发送客户<\/button>/);
  assert.match(detailActionsSource, />手动确认<\/button>/);
  assert.doesNotMatch(detailActionsSource, /latestSentDelivery|QuotationResponseDialog|setDecision\(/);
  assert.doesNotMatch(detailActionsSource, />客户接受<\/button>|>客户拒绝<\/button>/);
  assert.doesNotMatch(detailActionsSource, /当前版本没有系统邮件发送记录/);
  assert.equal((emailDialogSource.match(/setSendKey\(requestKey\(\)\)/g) || []).length, 5);
});

test("quotation void uses the displayed version as an optimistic concurrency guard", () => {
  assert.match(
    quotesModuleSource,
    /method: "DELETE",[\s\S]*expectedVersionNumber: Number\(quotation\.currentVersionNumber \|\| 1\)/,
  );
});

test("read-only quotation users do not see mutation entry points", () => {
  assert.match(quotationsViewSource, /\{canWriteQuotations \? \([\s\S]*新建报价[\s\S]*\) : null\}/);
  assert.doesNotMatch(quotationsViewSource, /disabled=\{!canWriteQuotations\}/);
});

test("quotations module opens with a visible CRM workspace before the quote ledger", () => {
  assert.match(quotationsViewSource, /<QuotationCrmWorkspace/);
  assert.match(quotationCrmSource, /aria-label="客户与报价 CRM 工作台"/);
  assert.match(quotationCrmSource, /CRM 工作台/);
  assert.match(quotationCrmSource, /业务员客户/);
  assert.match(quotationCrmSource, /跟进提醒/);
  assert.match(quotationCrmSource, /报价时间线/);
  assert.doesNotMatch(quotationCrmSource, /物料编码与固定产品属性/);
  assert.doesNotMatch(quotationCrmSource, /有物料编码客户/);
  assert.doesNotMatch(quotationCrmSource, /无物料编码客户/);
  assert.match(quotationCrmSource, /历史报价明细/);
  assert.match(quotationsViewSource, /搜索客户 \/ 联系人 \/ 报价号 \/ 发票号 \/ 业务员/);
});

test("quotation CRM automatically includes salesperson-owned customer masters", () => {
  const insights = buildCustomerInsights([], [{
    id: "customer-1",
    name: "Zhejiang Client Co., Ltd.",
    shortName: "浙江客户",
    contactPerson: "王总",
    updatedAt: "2026-08-20T00:00:00.000Z",
  }]);
  assert.equal(insights.length, 1);
  assert.equal(insights[0]?.customerId, "customer-1");
  assert.equal(insights[0]?.name, "浙江客户");
  assert.equal(insights[0]?.quoteCount, 0);
  assert.equal(insights[0]?.latestQuotation, undefined);
  assert.ok(quotationCrmSource.includes('apiJson<CustomersResponse>("/api/customers")'));
  assert.match(quotationCrmSource, /buildCustomerInsights\(quotations, customerMasters\)/);
  assert.match(quotationCrmSource, /自动带出权限范围内客户/);
  assert.match(quotesModuleSource, /canReadPermission\(currentUser, permissions, "customers"/);
  assert.match(quotationsViewSource, /canReadCustomers=\{canReadCustomers\}/);
});

test("quotation CRM customer cards open a customer detail and product library page", () => {
  assert.match(quotationCrmSource, /useState\(""\)/);
  assert.match(quotationCrmSource, /setSelectedCustomerKey\(nextCustomer\.key\)/);
  assert.match(quotationCrmSource, /<QuotationCustomerDetail/);
  assert.match(quotationCrmSource, /进入客户详情 \/ 客户产品库/);
  assert.match(quotationCustomerDetailSource, /aria-label="客户 CRM 详情"/);
  assert.match(quotationCustomerDetailSource, /返回客户工作台/);
  assert.match(quotationCustomerProductsSource, /\/api\/customer-products\?\$\{params\}/);
  assert.match(quotationCustomerProductsSource, /客户产品库读取中/);
  assert.match(quotationCustomerDetailSource, /物料编码与产品属性/);
  assert.match(quotationCustomerDetailSource, /styles\.fullWidthPanel/);
  assert.match(quotationCustomerDetailSource, /该客户报价记录/);
  assert.match(quotationCustomerDetailSource, /onViewQuotation\(quotation\)/);
});

test("quotation CRM customer detail can create and edit customer products", () => {
  assert.match(quotationCustomerProductsSource, /type ProductForm/);
  assert.match(quotationCustomerProductsSource, /新增产品/);
  assert.match(quotationCustomerProductsSource, /编辑客户产品/);
  assert.match(quotationCustomerProductsSource, /保存客户产品/);
  assert.match(quotationCustomerProductsSource, /method: form\.id \? "PATCH" : "POST"/);
  assert.match(quotationCustomerProductsSource, /\/api\/customer-products\/\$\{encodeURIComponent\(form\.id\)\}/);
  assert.match(quotationCustomerProductsSource, /customerId: customer\.customerId/);
  assert.match(quotationCustomerProductsSource, /setReloadToken\(\(value\) => value \+ 1\)/);
  assert.match(quotationCustomerProductsSource, /canWriteQuotations \? /);
  assert.match(quotationCustomerProductsSource, /productFormFromRow\(product\)/);
  assert.match(quotationCustomerProductsSource, /<ProductCards/);
  assert.match(quotationCustomerProductsSource, /未设置物料编码/);
  assert.doesNotMatch(quotationCustomerProductsSource, /修改客户产品不会改写历史报价/);
  assert.doesNotMatch(quotationCrmSource, /不用再从一张报价表里猜下一步/);
  assert.doesNotMatch(quotationCrmSource, /productPlaybook/);
});

test("quotation CRM customer detail can safely void customer products", () => {
  assert.match(quotationCustomerProductsSource, /function voidProduct\(product: CustomerProduct\)/);
  assert.match(quotationCustomerProductsSource, /确认删除/);
  assert.match(quotationCustomerProductsSource, /历史报价不会改变/);
  assert.match(quotationCustomerProductsSource, /method: "DELETE"/);
  assert.match(quotationCustomerProductsSource, /setForm\(\(current\) => current\?\.id === product\.id \? null : current\)/);
  assert.match(quotationCustomerProductsSource, /客户产品已删除/);
  assert.match(quotationCustomerProductsSource, />删除<\/button>/);
  assert.doesNotMatch(quotationCustomerProductsSource, /作废\/删除/);
});

test("quotation CRM customer detail maintains contacts through a scoped customer API", () => {
  assert.match(quotationCustomerDetailSource, /<QuotationCustomerContacts/);
  assert.match(quotationCustomerContactsSource, /联系人维护/);
  assert.match(quotationCustomerContactsSource, /保存联系人/);
  assert.match(quotationCustomerContactsSource, /\/api\/customers\/\$\{encodeURIComponent\(customer\.customerId\)\}\/contact/);
  assert.match(quotationCustomerContactsSource, /method: "PATCH"/);
  assert.match(customerCrmServiceSource, /updateCustomerContactInfo/);
  assert.match(customerCrmServiceSource, /assertCustomerScope\(actor, customerId\)/);
  assert.match(customerCrmServiceSource, /联系邮箱格式错误/);
});

test("quotation CRM customer detail records follow-ups and next reminders", () => {
  assert.match(quotationCustomerDetailSource, /<QuotationCustomerFollowUps/);
  assert.match(quotationCustomerFollowUpsSource, /记录沟通与下次提醒/);
  assert.match(quotationCustomerFollowUpsSource, /\/api\/customer-follow-ups\?\$\{params\}/);
  assert.match(quotationCustomerFollowUpsSource, /\/api\/customer-follow-ups"/);
  assert.match(quotationCustomerFollowUpsSource, /\/api\/customer-follow-ups\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(quotationCustomerFollowUpsSource, /下次跟进/);
  assert.match(quotationCustomerFollowUpsSource, />完成<\/button>/);
  assert.match(customerCrmServiceSource, /listCustomerFollowUps/);
  assert.match(customerCrmServiceSource, /saveCustomerFollowUp/);
  assert.match(customerCrmServiceSource, /completeCustomerFollowUp/);
  assert.match(customerFollowUpsMigration, /CREATE TABLE "customer_follow_ups"/);
  assert.match(customerFollowUpsMigration, /FOREIGN KEY \("customer_id"\) REFERENCES "customers"/);
});

test("quotation CRM customer detail reads existing shipment orders and receivables", () => {
  assert.match(quotationCustomerDetailSource, /<QuotationCustomerBusinessRecords/);
  assert.match(quotationCustomerBusinessSource, /发货与应收/);
  assert.match(quotationCustomerBusinessSource, /客户经营记录/);
  assert.match(quotationCustomerBusinessSource, /\/api\/customer-business-records\?\$\{params\}/);
  assert.match(quotationCustomerBusinessSource, /打开应收订单/);
  assert.match(quotationCustomerBusinessSource, /打开收款管理/);
  assert.match(quotationCustomerBusinessSource, /QuickCreatePaymentPanel/);
  assert.match(quotationCustomerBusinessSource, /SideDetailDrawer/);
  assert.match(quotationCustomerBusinessSource, /登记收款/);
  assert.match(quotationCustomerBusinessSource, /initialOrder=\{paymentOrder\}/);
  assert.match(quotationCustomerBusinessSource, /canConfirmArrived=\{canConfirmPayments\}/);
  assert.match(quotationCustomerBusinessSource, /setReloadToken\(\(value\) => value \+ 1\)/);
  assert.match(customerBusinessRouteSource, /listCustomerBusinessRecords/);
  assert.match(customerCrmServiceSource, /export async function listCustomerBusinessRecords/);
  assert.match(customerCrmServiceSource, /const customerId = String\(query\.get\("customerId"\)/);
  assert.match(customerCrmServiceSource, /orderAccessWhere\(actor\)/);
  assert.match(customerCrmServiceSource, /function shippedOrderWhere\(\): Prisma\.ReceivableOrderWhereInput/);
  assert.match(customerCrmServiceSource, /actualShipmentDate: \{ not: null \}/);
  assert.match(customerCrmServiceSource, /actualShipmentAmount: \{ not: null \}/);
  assert.match(customerCrmServiceSource, /status: \{ contains: "发货" \}/);
  assert.match(customerCrmServiceSource, /AND: \[\{ customerId, deletedAt: null \}, shippedOrderWhere\(\), orderAccessWhere\(actor\)\]/);
  assert.match(customerCrmServiceSource, /serializeOrderListRow\(scopeOrderForActor\(order, actor\)\)/);
  assert.match(customerCrmServiceSource, /serializePayment/);
  assert.match(quotesModuleSource, /canReadPermission\(currentUser, permissions, "orders"/);
  assert.match(quotesModuleSource, /canReadPermission\(currentUser, permissions, "payments"/);
  assert.match(quotesModuleSource, /const canRegisterPayments = canConfirmPayments \|\| currentUser\.role === "业务员"/);
  assert.match(quotationCrmSource, /canRegisterPayments=\{canRegisterPayments\}/);
  assert.match(quotationCustomerDetailSource, /canRegisterPayments=\{canRegisterPayments\}/);
  assert.match(quotationsViewSource, /onOpenOrders=\{actions\.onOpenOrders\}/);
  assert.match(quotationsViewSource, /onOpenPayments=\{actions\.onOpenPayments\}/);
});

test("quotation mutations reject same-tick duplicate submits", () => {
  for (const source of [formSource, emailDialogSource, detailActionsSource, quotesModuleSource]) {
    assert.match(source, /BusyRef|savingRef|sendingRef/);
    assert.match(source, /\.current\) return/);
  }
  const deletionSource = readFileSync("app/modules/quotations/use-quotation-deletion.ts", "utf8");
  assert.match(deletionSource, /deletingBusyRef\.current/);
});

test("quotation email draft contract failures remain visible to the user", () => {
  assert.match(emailDialogSource, /if \(!result\.draft\) throw new Error\(result\.message \|\| "邮件草稿数据缺失，请刷新后重试"\)/);
  assert.match(emailDialogSource, /role="alert" aria-live="assertive"/);
});
