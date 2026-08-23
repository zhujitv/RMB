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
const { buildCustomerInsights, filterCustomerInsights } = await jiti.import<typeof import("../app/modules/quotations/quotation-crm-insights.ts")>(
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
const customerProductsManagerSource = readFileSync("app/modules/settings/customer-products-manager.tsx", "utf8");
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

test("quotation product descriptions keep raw spacing while focused and normalize when editing ends", () => {
  assert.deepEqual(visibleProductDescriptionParts("POLIVAN ", ""), { description: "POLIVAN ", specification: "" });
  assert.match(editorSource, /const \[rawDescription, setRawDescription\] = useState\(canonicalDescription\)/);
  assert.match(editorSource, /const description = editingDescription && !disabled \? rawDescription : canonicalDescription/);
  assert.match(editorSource, /setRawDescription\(canonicalDescription\);\s*setEditingDescription\(true\)/);
  assert.match(editorSource, /const nextDescription = event\.target\.value;\s*setRawDescription\(nextDescription\);[\s\S]*visibleProductDescriptionParts\(nextDescription, item\.specification\)/);
  assert.match(editorSource, /setEditingDescription\(false\);\s*setOpen\(false\)/);
  assert.doesNotMatch(editorSource, /setRawDescription\(nextDescription\.trim\(\)\)/);
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
  assert.match(editorSource, /visibleProductDescriptionParts\(nextDescription, item\.specification\)/);
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
  assert.match(quotationCrmSource, /共 \{customerInsights\.length\} 位/);
  assert.match(quotationCrmSource, /当前筛选 \{filteredCustomers\.length\} 位/);
  assert.doesNotMatch(quotationCrmSource, /slice\(0,\s*MAX_VISIBLE_CUSTOMERS\)/);
  assert.doesNotMatch(quotationCrmSource, /MAX_VISIBLE_CUSTOMERS\s*=\s*4/);
  assert.match(quotationCrmSource, /CUSTOMER_PAGE_SIZE\s*=\s*5/);
  assert.match(quotationCrmSource, /filteredCustomers = filterCustomerInsights/);
  assert.match(quotationCrmSource, /visibleCustomers = filteredCustomers\.slice/);
  assert.match(quotationCrmSource, /共 \{filteredCustomers\.length\} 位客户，当前第 \{safeCustomerPage\} \/ \{customerTotalPages\} 页/);
  assert.match(quotationCrmSource, /上一页/);
  assert.match(quotationCrmSource, /下一页/);
  assert.match(quotesModuleSource, /canReadPermission\(currentUser, permissions, "customers"/);
  assert.match(quotationsViewSource, /canReadCustomers=\{canReadCustomers\}/);
});

test("quotation CRM can search and segment customers before pagination", () => {
  const insights = buildCustomerInsights([{
    id: "quote-1",
    quoteNo: "Q-ALPHA",
    status: "SENT",
    customerId: "customer-1",
    customer: { id: "customer-1", shortName: "阿尔法", fullName: "Alpha Trading", contactPerson: "Alice", contactEmail: "alice@example.com", contactPhone: "13800000000" },
    currentVersion: { validUntil: "2026-08-01", items: [{ description: "Decking board", specification: "140x25", unit: "PCS", customerProductId: "MAT-001" }] },
    updatedAt: "2026-08-10T00:00:00.000Z",
  }, {
    id: "quote-2",
    quoteNo: "Q-BETA",
    status: "ACCEPTED",
    customerId: "customer-2",
    customer: { id: "customer-2", shortName: "贝塔", fullName: "Beta Build", contactPerson: "Bob", contactEmail: "bob@example.com", contactPhone: "13900000000" },
    currentVersion: { items: [{ description: "Wall panel", unit: "PCS" }] },
    updatedAt: "2026-08-09T00:00:00.000Z",
  }], [{
    id: "customer-3",
    name: "Gamma Empty",
    shortName: "伽马",
    updatedAt: "2026-08-08T00:00:00.000Z",
  }]);
  assert.equal(filterCustomerInsights(insights, "Alice", "all").map((customer) => customer.customerId).join(","), "customer-1");
  assert.equal(filterCustomerInsights(insights, "MAT-001", "all").map((customer) => customer.customerId).join(","), "customer-1");
  assert.equal(filterCustomerInsights(insights, "Q-BETA", "accepted").map((customer) => customer.customerId).join(","), "customer-2");
  assert.equal(filterCustomerInsights(insights, "", "followUp").map((customer) => customer.customerId).join(","), "customer-1");
  assert.equal(filterCustomerInsights(insights, "", "missingContact").map((customer) => customer.customerId).join(","), "customer-3");
  assert.equal(filterCustomerInsights(insights, "", "noQuote").map((customer) => customer.customerId).join(","), "customer-3");
  assert.match(quotationCrmSource, /搜索客户 \/ 联系人 \/ 电话 \/ 邮箱 \/ 报价号 \/ 产品/);
  assert.match(quotationCrmSource, /CUSTOMER_FILTER_OPTIONS\.map/);
  assert.match(quotationCrmSource, /\[customerKeyword, customerFilter\]/);
});

test("quotation CRM customer detail keeps the low-frequency product library behind a modal", () => {
  assert.match(quotationCrmSource, /useState\(""\)/);
  assert.match(quotationCrmSource, /setSelectedCustomerKey\(nextCustomer\.key\)/);
  assert.match(quotationCrmSource, /<QuotationCustomerDetail/);
  assert.match(quotationCrmSource, /进入客户详情/);
  assert.doesNotMatch(quotationCrmSource, /进入客户详情 \/ 客户产品库/);
  assert.match(quotationCustomerDetailSource, /aria-label="客户 CRM 详情"/);
  assert.match(quotationCustomerDetailSource, /返回客户工作台/);
  assert.match(quotationCustomerDetailSource, /管理产品库/);
  assert.match(quotationCustomerDetailSource, /setProductsOpen\(true\)/);
  assert.match(quotationCustomerDetailSource, /<CustomerProductsManager/);
  assert.match(quotationCustomerDetailSource, /canWrite=\{canWriteQuotations\}/);
  assert.doesNotMatch(quotationCustomerDetailSource, /<QuotationCustomerProductsEditor/);
  assert.match(quotationCustomerDetailSource, /该客户报价记录/);
  assert.match(quotationCustomerDetailSource, /onViewQuotation\(quotation\)/);
});

test("customer product modal supports scoped create and edit with read-only fallback", () => {
  assert.match(customerProductsManagerSource, /type ProductForm/);
  assert.match(customerProductsManagerSource, /新增产品/);
  assert.match(customerProductsManagerSource, /编辑产品属性/);
  assert.match(customerProductsManagerSource, /保存产品属性/);
  assert.match(customerProductsManagerSource, /method: form\.id \? "PATCH" : "POST"/);
  assert.match(customerProductsManagerSource, /customerId: customer\.id/);
  assert.match(customerProductsManagerSource, /setReloadToken\(\(value\) => value \+ 1\)/);
  assert.match(customerProductsManagerSource, /canWrite \? /);
  assert.match(customerProductsManagerSource, /productFormFromRow\(product\)/);
  assert.match(customerProductsManagerSource, /useWorkspaceTabDirty\(Boolean\(form\)\)/);
  assert.match(customerProductsManagerSource, /useWorkspaceTabBusy\(saving\)/);
  assert.match(customerProductsManagerSource, /仅查看/);
  assert.doesNotMatch(quotationCrmSource, /不用再从一张报价表里猜下一步/);
  assert.doesNotMatch(quotationCrmSource, /productPlaybook/);
});

test("customer product modal can safely void products", () => {
  assert.match(customerProductsManagerSource, /function voidProduct\(product: CustomerProductRow\)/);
  assert.match(customerProductsManagerSource, /确认删除/);
  assert.match(customerProductsManagerSource, /历史报价和销售数据不会改变/);
  assert.match(customerProductsManagerSource, /method: "DELETE"/);
  assert.match(customerProductsManagerSource, /setForm\(\(current\) => current\?\.id === product\.id \? null : current\)/);
  assert.match(customerProductsManagerSource, /产品属性已删除/);
  assert.match(customerProductsManagerSource, />作废<\/button>/);
});

test("quotation CRM customer detail maintains contacts through a scoped customer API", () => {
  assert.match(quotationCustomerDetailSource, /<QuotationCustomerContacts/);
  assert.match(quotationCustomerContactsSource, /联系人维护/);
  assert.match(quotationCustomerContactsSource, /保存联系人/);
  assert.match(quotationCustomerContactsSource, /主要联系人/);
  assert.match(quotationCustomerContactsSource, /资料完整度/);
  assert.match(quotationCustomerContactsSource, /撤销修改/);
  assert.match(quotationCustomerContactsSource, /拨打电话/);
  assert.match(quotationCustomerContactsSource, /发送邮件/);
  assert.match(quotationCustomerContactsSource, /onSaved\?\.\(savedContact\)/);
  assert.match(quotationCustomerContactsSource, /useWorkspaceTabDirty\(dirty\)/);
  assert.match(quotationCustomerContactsSource, /useWorkspaceTabBusy\(saving\)/);
  assert.doesNotMatch(quotationCustomerContactsSource, /已关联客户资料/);
  assert.match(quotationCrmSource, /updateSelectedCustomerContact/);
  assert.match(quotationCrmSource, /setCustomerMasters/);
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
