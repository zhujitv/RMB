import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  allocationPayload,
  allocationPayloadByLine,
  applyDefaultSupplier,
  directExecutionPayload,
  draftFromExecution,
  duplicateSalesLine,
  itemWeightsPayload,
  singleSupplierIdFromItems,
  validateSalesExecutionDraft,
} = await jiti.import<typeof import("../app/modules/sales-execution/draft-utils.ts")>("../app/modules/sales-execution/draft-utils.ts");
const { customerOrderNumber, filterSupplierOptions } = await jiti.import<typeof import("../app/modules/sales-execution/types.ts")>("../app/modules/sales-execution/types.ts");
const {
  factoryPurchaseOrderStatusLabel,
  salesExecutionStatusLabel,
  supplierResponseSummary,
} = await jiti.import<typeof import("../app/modules/sales-execution/status-values.ts")>("../app/modules/sales-execution/status-values.ts");

const moduleSource = readFileSync("app/modules/SalesExecutionModule.tsx", "utf8");
const formSource = readFileSync("app/modules/sales-execution/execution-form-panel.tsx", "utf8");
const linesSource = readFileSync("app/modules/sales-execution/sales-lines-editor.tsx", "utf8");
const allocationSource = readFileSync("app/modules/sales-execution/allocation-editor.tsx", "utf8");
const detailSource = readFileSync("app/modules/sales-execution/execution-detail-drawer.tsx", "utf8");
const purchaseDraftSource = readFileSync("app/modules/sales-execution/purchase-order-draft-list.tsx", "utf8");
const productSuggestionSource = readFileSync("app/modules/sales-execution/product-suggestion-input.tsx", "utf8");
const listSource = readFileSync("app/modules/sales-execution/execution-list.tsx", "utf8");
const viewSource = readFileSync("app/modules/sales-execution/sales-execution-module-view.tsx", "utf8");
const dispatchSource = readFileSync("app/modules/sales-execution/use-sales-execution-dispatch.ts", "utf8");
const emailRetrySource = readFileSync("app/modules/sales-execution/use-sales-execution-email-retry.ts", "utf8");
const voidSource = readFileSync("app/modules/sales-execution/use-sales-execution-void.ts", "utf8");
const salesExecutionUiSource = [moduleSource, ...readdirSync("app/modules/sales-execution")
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => readFileSync(`app/modules/sales-execution/${name}`, "utf8"))]
  .join("\n");

function validDraft() {
  const draft = draftFromExecution(null);
  draft.customerId = "customer-1";
  draft.businessEntityId = "entity-1";
  draft.customerOrderNo = "PO-CUSTOMER-20260809";
  draft.requestedDeliveryDate = "2026-09-15";
  draft.items[0] = {
    ...draft.items[0]!,
    name: "Universal panel WPC",
    specification: "24*140*2900 mm",
    unit: "PCS",
    quantity: "10",
    salesUnitPrice: "20",
    allocations: [{
      ...draft.items[0]!.allocations[0]!,
      supplierId: "supplier-1",
      purchaseCurrency: "CNY",
      allocatedQuantity: "10",
      purchaseUnitPrice: "12",
    }],
  };
  return draft;
}

test("direct sales execution requires an explicitly selected business entity", () => {
  const draft = validDraft();
  draft.businessEntityId = "";
  assert.equal(validateSalesExecutionDraft(draft), "请选择业务主体");
  assert.match(formSource, /<option value="">请选择业务主体<\/option>/);
  assert.doesNotMatch(formSource, /isDefault/);
});

test("customer order number and customer requested delivery date are mandatory credentials", () => {
  const missingOrderNo = validDraft();
  missingOrderNo.customerOrderNo = "   ";
  assert.equal(validateSalesExecutionDraft(missingOrderNo), "请填写客户订单号");

  const missingDeliveryDate = validDraft();
  missingDeliveryDate.requestedDeliveryDate = "";
  assert.equal(validateSalesExecutionDraft(missingDeliveryDate), "请选择客户要求交货日期");

  const payload = directExecutionPayload(validDraft());
  assert.equal(payload.customerOrderNo, "PO-CUSTOMER-20260809");
  assert.equal(payload.requestedDeliveryDate, "2026-09-15");
  assert.match(formSource, /客户订单号[\s\S]{0,160}<input[^>]*required/);
  assert.match(formSource, /客户要求交货日期[\s\S]{0,160}<input[^>]*type="date"[^>]*required/);
  assert.doesNotMatch(formSource, /客户订单号（可选）|要求交货日期（可选）/);
});

test("sales execution surfaces customer order numbers instead of internal execution numbers", () => {
  assert.equal(customerOrderNumber({ id: "execution-1", customerOrderNo: " PO-CUSTOMER-20260809 ", requestedDeliveryDate: "2026-09-15" }), "PO-CUSTOMER-20260809");
  assert.match(listSource, />客户订单号<\/th>/);
  assert.match(listSource, /customerOrderNumber\(row\)/);
  assert.match(viewSource, /placeholder="搜索客户订单号 \/ 客户 \/ 报价号"/);
  assert.doesNotMatch(salesExecutionUiSource, /执行单号/);
  assert.doesNotMatch(salesExecutionUiSource, /executionNumber|\.executionNo/);
});

test("sales execution list omits version and standalone sales currency columns", () => {
  assert.doesNotMatch(listSource, />版本<\/th>/);
  assert.doesNotMatch(listSource, />销售币种<\/th>/);
  assert.doesNotMatch(listSource, /V\{row\.currentVersionNumber/);
  assert.doesNotMatch(listSource, /<td>\{row\.currency/);
  assert.equal((listSource.match(/colSpan=\{8\}/g) || []).length, 2);
});

test("factory allocations must equal each sales line quantity exactly", () => {
  const draft = validDraft();
  assert.equal(validateSalesExecutionDraft(draft), "");
  draft.items[0]!.allocations[0]!.allocatedQuantity = "9";
  assert.match(validateSalesExecutionDraft(draft), /还有 1 未分配/);
  draft.items[0]!.allocations[0]!.allocatedQuantity = "11";
  assert.match(validateSalesExecutionDraft(draft), /分配超出 1/);
  draft.items[0]!.allocations = [
    { ...draft.items[0]!.allocations[0]!, allocatedQuantity: "5" },
    { ...draft.items[0]!.allocations[0]!, key: "duplicate", allocatedQuantity: "5" },
  ];
  assert.match(validateSalesExecutionDraft(draft), /同一工厂和采购币种只能填写一条分配/);
  assert.match(allocationSource, /已精确分配/);
  assert.match(allocationSource, /保存前，所有工厂分配数量之和必须与本行销售数量完全一致/);
});

test("factory selection uses fuzzy autocomplete instead of a static dropdown", () => {
  const suppliers = [
    { id: "factory-1", supplierName: "东台市绿华塑木科技有限公司", supplierType: "产品供应商" },
    { id: "factory-2", supplierName: "安徽科蓝特铝业股份有限公司", supplierType: "产品供应商" },
  ];
  assert.deepEqual(filterSupplierOptions(suppliers, "绿华 塑木").map((supplier) => supplier.id), ["factory-1"]);
  assert.deepEqual(filterSupplierOptions(suppliers, "铝业").map((supplier) => supplier.id), ["factory-2"]);
  assert.match(allocationSource, /SearchAutocomplete/);
  assert.match(allocationSource, /输入工厂名称模糊查找/);
  assert.match(allocationSource, /onSelectedValueInvalidated=\{\(\) => onSelect\(""\)\}/);
  assert.match(allocationSource, /supplier\.id.*supplierName\(supplier\).*supplier\.supplierType/);
  assert.doesNotMatch(allocationSource, /searchOnFocus/);
  assert.doesNotMatch(allocationSource, /<option value="">请选择产品供应商<\/option>/);
});

test("one default factory fills only empty single allocations and follows sales quantity", () => {
  const draft = validDraft();
  const emptyLine = {
    ...draft.items[0]!,
    key: "empty-line",
    quantity: "25",
    allocations: [{ ...draft.items[0]!.allocations[0]!, key: "empty-allocation", supplierId: "", allocatedQuantity: "" }],
  };
  const existingLine = {
    ...draft.items[0]!,
    key: "existing-line",
    allocations: [{ ...draft.items[0]!.allocations[0]!, key: "existing-allocation", supplierId: "supplier-override" }],
  };
  const splitLine = {
    ...draft.items[0]!,
    key: "split-line",
    allocations: [
      { ...draft.items[0]!.allocations[0]!, key: "split-a", supplierId: "", allocatedQuantity: "5" },
      { ...draft.items[0]!.allocations[0]!, key: "split-b", supplierId: "", allocatedQuantity: "5" },
    ],
  };
  const result = applyDefaultSupplier([emptyLine, existingLine, splitLine], "supplier-default");
  assert.equal(result[0]?.allocations[0]?.supplierId, "supplier-default");
  assert.equal(result[0]?.allocations[0]?.allocatedQuantity, "25");
  assert.equal(result[1]?.allocations[0]?.supplierId, "supplier-override");
  assert.deepEqual(result[2]?.allocations, splitLine.allocations);
  assert.equal(singleSupplierIdFromItems([{ ...emptyLine, allocations: result[0]!.allocations }]), "supplier-default");
  assert.match(formSource, /整单默认工厂（可选）[\s\S]*SearchAutocomplete/);
  assert.match(formSource, /applyDefaultSupplier\(current\.items, supplier\.id\)/);
  assert.match(linesSource, /followsSalesQuantity[\s\S]*allocatedQuantity: quantity/);
});

test("sales and purchase prices use separate payloads", () => {
  const draft = validDraft();
  const salesPayload = directExecutionPayload(draft);
  assert.equal(salesPayload.items[0]?.salesUnitPrice, "20");
  assert.equal("purchaseUnitPrice" in (salesPayload.items[0] || {}), false);
  assert.equal("supplierId" in (salesPayload.items[0] || {}), false);

  const purchasePayload = allocationPayload({
    id: "execution-1",
    revision: 3,
    customerOrderNo: "PO-CUSTOMER-20260809",
    requestedDeliveryDate: "2026-09-15",
    items: [{ id: "saved-item-1", lineNumber: 1 }],
  }, draft);
  assert.equal(purchasePayload.expectedRevision, 3);
  assert.deepEqual(purchasePayload.allocations[0], {
    executionItemId: "saved-item-1",
    supplierId: "supplier-1",
    purchaseCurrency: "CNY",
    purchaseUnitPrice: "12",
    allocatedQuantity: "10",
    remark: "",
  });
  assert.equal("salesUnitPrice" in purchasePayload.allocations[0]!, false);

  const atomicAllocations = allocationPayloadByLine(draft);
  assert.equal(atomicAllocations[0]?.executionLineNumber, 1);
  assert.equal(atomicAllocations[0]?.purchaseUnitPrice, "12");
  assert.equal("salesUnitPrice" in atomicAllocations[0]!, false);
});

test("purchase unit price can stay empty without creating a false zero total", () => {
  const draft = validDraft();
  draft.items[0]!.allocations[0]!.purchaseUnitPrice = "";
  assert.equal(validateSalesExecutionDraft(draft), "");
  const saved = { id: "execution-1", revision: 1, customerOrderNo: "PO-1", requestedDeliveryDate: "2026-09-15", items: [{ id: "item-1", lineNumber: 1 }] };
  assert.equal(allocationPayload(saved, draft).allocations[0]?.purchaseUnitPrice, null);
  assert.equal(allocationPayloadByLine(draft)[0]?.purchaseUnitPrice, null);
  assert.match(allocationSource, /采购单价[\s\S]{0,200}待供应商回填/);
  assert.match(allocationSource, /待供应商回填/);
  assert.match(purchaseDraftSource, /total === null \? "待供应商回填"/);
  assert.match(detailSource, /成本待回填/);
});

test("unit net weight survives drafts and payloads while remaining editable for quotation sources", () => {
  const draft = validDraft();
  draft.items[0]!.id = "execution-item-1";
  draft.items[0]!.unitNetWeightKg = "2.75";
  assert.equal(directExecutionPayload(draft).items[0]?.unitNetWeightKg, "2.75");
  assert.deepEqual(itemWeightsPayload(draft), [{ executionItemId: "execution-item-1", unitNetWeightKg: "2.75" }]);
  const restored = draftFromExecution({
    id: "execution-1",
    customerOrderNo: "PO-1",
    requestedDeliveryDate: "2026-09-15",
    items: [{ id: "execution-item-1", unitNetWeightKg: "2.75" }],
  });
  assert.equal(restored.items[0]?.unitNetWeightKg, "2.75");
  draft.items[0]!.unitNetWeightKg = "";
  assert.equal(directExecutionPayload(draft).items[0]?.unitNetWeightKg, null);
  assert.match(linesSource, /单件\/单套净重 \(kg\)[\s\S]*value=\{item\.unitNetWeightKg\}[\s\S]*disabled=\{disabled\}/);
  assert.match(formSource, /itemWeights: itemWeightsPayload\(form\)/);
  assert.match(detailSource, /单件\/单套净重 \(kg\)/);
});

test("existing draft changes save sales and factory allocations atomically", () => {
  assert.match(formSource, /allocations: allocationPayloadByLine\(form\)/);
  assert.match(formSource, /if \(changed\)/);
  assert.match(formSource, /onSaved\(headerSaved/);
});

test("duplicating a direct sales line creates independent allocation rows", () => {
  const draft = validDraft();
  const original = draft.items[0]!;
  const result = duplicateSalesLine(draft.items, original.key);
  assert.equal(result.length, 2);
  assert.notEqual(result[1]?.key, original.key);
  assert.notEqual(result[1]?.allocations[0]?.key, original.allocations[0]?.key);
  assert.equal(result[1]?.id, undefined);
  assert.equal(result[1]?.allocations[0]?.executionItemId, "");
});

test("workspace focus supports direct create, quote conversion and execution detail", () => {
  for (const prop of ["initialKeyword", "initialAction", "initialQuotationId", "initialExecutionId", "initialOpenToken"]) {
    assert.match(moduleSource, new RegExp(prop));
  }
  assert.match(moduleSource, /sourceType: "QUOTATION"/);
  assert.match(moduleSource, /expectedVersionNumber: Number\(quotation\.currentVersionNumber \|\| 1\)/);
  assert.match(formSource, /creationKey/);
  assert.match(formSource, /expectedRevision/);
});

test("quotation conversion collects required order credentials before POST", () => {
  assert.match(salesExecutionUiSource, /<form[\s\S]*客户订单号[\s\S]*客户要求交货日期/);
  assert.match(salesExecutionUiSource, /type QuotationConversionDraft[\s\S]*customerOrderNo:\s*string[\s\S]*requestedDeliveryDate:\s*string/);
  assert.match(moduleSource, /setConversionDraft\(\{[\s\S]*customerOrderNo:\s*""[\s\S]*requestedDeliveryDate:\s*""[\s\S]*\}\)/);
  assert.match(moduleSource, /submitQuotationConversion\(draft:[\s\S]*body:\s*JSON\.stringify\(\{ sourceType:\s*"QUOTATION", \.\.\.draft \}\)/);
});

test("quote source locks sales fields while direct drafts can reuse customer products and prices", () => {
  assert.match(linesSource, /quotationSource/);
  assert.match(linesSource, /销售数据来自已接受报价，不可修改/);
  assert.match(linesSource, /客户销售单价/);
  assert.match(allocationSource, /工厂采购分配/);
  assert.match(formSource, /\/api\/customer-products/);
  assert.match(formSource, /salesPriceSource/);
  assert.match(productSuggestionSource, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}[\s\S]*onClick=\{\(\) => selectProduct\(product\)\}/);
});

test("sales entry and generated factory purchase orders use one product description field", () => {
  assert.match(linesSource, /产品描述\s*\n/);
  assert.doesNotMatch(linesSource, /产品描述（含规格）/);
  assert.match(purchaseDraftSource, /item\.productDescription/);
  assert.match(purchaseDraftSource, /<th>产品描述<\/th>/);
});

test("factory purchase draft receives only purchase-order snapshots", () => {
  assert.doesNotMatch(purchaseDraftSource, /SalesExecutionItem|salesItems|customerName|customerId|salesUnitPrice|salesAmount/);
  assert.match(purchaseDraftSource, /productNameSnapshot/);
  assert.match(purchaseDraftSource, /specificationSnapshot/);
  assert.match(purchaseDraftSource, /unitSnapshot/);
  assert.match(detailSource, /此视图仅包含工厂采购所需资料，不显示客户名称、客户销售价或利润/);
  assert.match(detailSource, /<PurchaseOrderDraftList[\s\S]*orders=\{orders\}[\s\S]*canRetryEmail=\{canRetryDispatchEmail\}/);
});

test("formal factory dispatch is an explicit locked transition with an empty-price warning", () => {
  assert.match(dispatchSource, /\/api\/sales-executions\/\$\{encodeURIComponent\(execution\.id\)\}\/dispatch/);
  assert.match(dispatchSource, /method: "POST"/);
  assert.match(dispatchSource, /expectedRevision: Number\(execution\.revision \|\| 1\)/);
  assert.match(dispatchSource, /正式下发工厂/);
  assert.match(dispatchSource, /销售内容和工厂分配将锁定/);
  assert.match(dispatchSource, /待供应商回填/);
  assert.match(dispatchSource, /有门户账号的在线通知，无门户账号的转为线下协同/);
  assert.match(dispatchSource, /供应商可在门户回复；通过微信、电话、邮件或纸质回复时，由内部人员如实代录/);
  assert.match(dispatchSource, /response\.execution \|\| response\.data/);
  assert.match(moduleSource, /useSalesExecutionDispatch/);
  assert.match(moduleSource, /executionDispatched[\s\S]*loadRows\(page, submittedKeyword, submittedStatus\)[\s\S]*loadDetail\(saved\.id\)/);
  assert.match(detailSource, /正式下发工厂/);
});

test("sales executions can be explicitly voided before shipping with a required audited reason", () => {
  assert.match(voidSource, /method: "DELETE"/);
  assert.match(voidSource, /reason: result\.inputValue/);
  assert.match(voidSource, /expectedRevision: Number\(execution\.revision \|\| 1\)/);
  assert.match(voidSource, /variant: "danger"/);
  assert.match(voidSource, /requireInput: true/);
  assert.match(voidSource, /useWorkspaceTabBusy\(voiding\)/);
  assert.match(moduleSource, /useSalesExecutionVoid\(\{ canWrite, onSaved: executionDispatched \}\)/);
  assert.match(moduleSource, /!voidAction\.voiding && !deleteAction\.deleting\) closeEditors\(\)/);
  assert.match(viewSource, /canVoid=\{canWrite && \["DRAFT", "DISPATCHED"\]\.includes\(String\(detailExecution\.status \|\| ""\)\) && !detailExecution\.receivableOrder && !detailExecution\.shippingStartedAt/);
  assert.match(detailSource, /className=\{shell\.dangerButton\}[\s\S]*作废销售执行/);
  assert.match(detailSource, /disabled=\{loading \|\| dispatching \|\| shippingStarting \|\| voiding \|\| deleting\}/);
});

test("failed factory email can be explicitly retried without redispatching the order", () => {
  assert.match(emailRetrySource, /\/dispatch-email\/retry/);
  assert.match(emailRetrySource, /expectedRevision: Number\(execution\?\.revision \|\| 1\)/);
  assert.match(emailRetrySource, /dispatchVersionNumber: Number\(purchaseOrder\.dispatchVersionNumber\)/);
  assert.match(purchaseDraftSource, /dispatchEmailStatus === "FAILED"/);
  assert.match(purchaseDraftSource, /dispatchEmailStatus === "NO_RECIPIENT"/);
  assert.match(purchaseDraftSource, /重试门户邮件/);
});

test("only draft sales executions remain editable or dispatchable", () => {
  assert.match(moduleSource, /editAfterLoad && canWrite && execution\.status === "DRAFT"/);
  assert.match(moduleSource, /detailExecution\.status !== "DRAFT"/);
  assert.match(viewSource, /detailExecution\.status === "DRAFT"/);
  assert.match(viewSource, /<option value="DISPATCHED">已下发<\/option>/);
  assert.doesNotMatch(moduleSource, /execution\.status !== "VOIDED"/);
});

test("sales and factory status labels expose supplier responses", () => {
  assert.equal(salesExecutionStatusLabel("DRAFT"), "草稿");
  assert.equal(salesExecutionStatusLabel("DISPATCHED"), "已下发");
  assert.equal(salesExecutionStatusLabel("DISPATCHED", true), "已进入发货");
  assert.equal(salesExecutionStatusLabel("DISPATCHED", true, "已取消"), "关联订单已取消");
  assert.equal(factoryPurchaseOrderStatusLabel("DISPATCHED"), "待工厂确认");
  assert.equal(factoryPurchaseOrderStatusLabel("ACCEPTED"), "已接受");
  assert.equal(factoryPurchaseOrderStatusLabel("DELIVERY_PROPOSED"), "建议新交期");
  assert.equal(factoryPurchaseOrderStatusLabel("REJECTED"), "已拒绝");
  assert.equal(supplierResponseSummary([
    { id: "accepted", status: "ACCEPTED" },
    { id: "pending", status: "DISPATCHED" },
    { id: "date-change", status: "DELIVERY_PROPOSED" },
    { id: "rejected", status: "REJECTED" },
    { id: "voided", status: "VOIDED" },
  ]), "已接受 1 · 待确认 1 · 新交期 1 · 拒绝 1");
  assert.match(listSource, /salesExecutionStatusLabel\(row\.status, Boolean\(row\.receivableOrder \|\| row\.shippingStartedAt\), row\.receivableOrder\?\.status\)/);
  assert.match(purchaseDraftSource, /factoryPurchaseOrderStatusLabel\(order\.status\)/);
  assert.match(purchaseDraftSource, /DELIVERY_PROPOSED/);
  assert.match(detailSource, /supplierResponseSummary\(orders\)/);
});

test("sales execution business files stay below the 300 line limit", () => {
  const files = ["app/modules/SalesExecutionModule.tsx", ...readdirSync("app/modules/sales-execution").map((name) => `app/modules/sales-execution/${name}`)];
  for (const file of files) {
    const lineCount = readFileSync(file, "utf8").split("\n").length - 1;
    assert.ok(lineCount <= 300, `${file} has ${lineCount} lines`);
  }
});

test("read-only sales execution users do not see the direct-create mutation entry", () => {
  assert.match(viewSource, /\{canWrite \? <button[\s\S]*直接新建[\s\S]*<\/button> : null\}/);
  assert.doesNotMatch(viewSource, /disabled=\{!canWrite\}/);
});

test("sales execution mutations reject same-tick duplicates and await detail refresh", () => {
  assert.match(formSource, /savingRef\.current/);
  assert.match(moduleSource, /conversionBusyRef\.current/);
  assert.match(moduleSource, /onFactoryExecutionChanged=\{\(\) =>[\s\S]*loadDetail\(detailExecution\.id\)/);
  for (const source of [
    dispatchSource,
    readFileSync("app/modules/sales-execution/use-sales-execution-shipping.ts", "utf8"),
    voidSource,
    emailRetrySource,
    readFileSync("app/modules/sales-execution/purchase-order-execution-panel.tsx", "utf8"),
    readFileSync("app/modules/sales-execution/purchase-order-delivery-actions.tsx", "utf8"),
    readFileSync("app/modules/sales-execution/purchase-order-reassignment-card.tsx", "utf8"),
    readFileSync("app/modules/sales-execution/purchase-order-settlement-card.tsx", "utf8"),
  ]) {
    assert.match(source, /BusyRef\.current|busyRef\.current/);
  }
});
