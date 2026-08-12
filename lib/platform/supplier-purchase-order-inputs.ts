import { codedError, isPlainRecord } from "./shared-base-errors";

type DateValue = Date | string | null | undefined;
type DecimalValue = { toString(): string } | string | number | null | undefined;
type SupplierResponseAction = "ACCEPTED" | "DELIVERY_PROPOSED" | "REJECTED";

export type SupplierPurchaseOrderPriceTarget = {
  id: string;
  purchaseUnitPrice: DecimalValue;
  supplierPrice: { unitPrice: DecimalValue } | null;
};

export type NormalizedSupplierPurchaseOrderPrice = {
  purchaseOrderItemId: string;
  unitPriceText: string;
};

function isoDate(value: DateValue) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function supplierUnitPrice(value: unknown, lineNumber: number) {
  const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(text) || !Number.isFinite(Number(text))) {
    throw codedError(
      `第 ${lineNumber} 行采购单价格式错误，最多 12 位整数和 6 位小数`,
      400,
      "SUPPLIER_PURCHASE_ORDER_UNIT_PRICE_INVALID",
    );
  }
  return text;
}

export function normalizeSupplierPurchaseOrderPrices(
  input: unknown,
  items: SupplierPurchaseOrderPriceTarget[],
): NormalizedSupplierPurchaseOrderPrice[] {
  const missingItems = items.filter((item) => item.purchaseUnitPrice == null && item.supplierPrice?.unitPrice == null);
  if (!missingItems.length) return [];
  if (!isPlainRecord(input) || !Array.isArray(input.itemPrices)) {
    throw codedError("请补齐所有待回填产品的采购单价", 400, "SUPPLIER_PURCHASE_ORDER_PRICES_REQUIRED");
  }
  if (input.itemPrices.length > 500) {
    throw codedError("单张采购单最多回填 500 行价格", 400, "SUPPLIER_PURCHASE_ORDER_PRICES_LIMIT");
  }
  const missingById = new Map(missingItems.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const rows = input.itemPrices.map((raw, index) => {
    if (!isPlainRecord(raw)) {
      throw codedError(`第 ${index + 1} 行价格格式错误`, 400, "SUPPLIER_PURCHASE_ORDER_PRICE_ROW_INVALID");
    }
    const purchaseOrderItemId = typeof raw.purchaseOrderItemId === "string" ? raw.purchaseOrderItemId.trim() : "";
    if (!purchaseOrderItemId || !missingById.has(purchaseOrderItemId)) {
      throw codedError("价格回填包含无效或无需回填的采购明细", 400, "SUPPLIER_PURCHASE_ORDER_PRICE_ITEM_INVALID");
    }
    if (seen.has(purchaseOrderItemId)) {
      throw codedError("同一采购明细不能重复回填价格", 400, "SUPPLIER_PURCHASE_ORDER_PRICE_ITEM_DUPLICATE");
    }
    seen.add(purchaseOrderItemId);
    return {
      purchaseOrderItemId,
      unitPriceText: supplierUnitPrice(raw.unitPrice, index + 1),
    };
  });
  if (seen.size !== missingItems.length) {
    throw codedError("请补齐所有待回填产品的采购单价", 400, "SUPPLIER_PURCHASE_ORDER_PRICES_REQUIRED");
  }
  return rows;
}

function requiredDate(value: unknown, message: string, code: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw codedError(message, 400, code);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw codedError(message, 400, code);
  }
  return { date, text };
}

function boundedRemark(value: unknown) {
  const remark = typeof value === "string" ? value.trim() : "";
  if (remark.length > 2_000) {
    throw codedError("回复备注不能超过 2000 个字符", 400, "SUPPLIER_PURCHASE_ORDER_REMARK_TOO_LONG");
  }
  return remark;
}

export type NormalizedSupplierPurchaseOrderResponse = {
  action: SupplierResponseAction;
  expectedRevision: number;
  deliveryDate: Date | null;
  deliveryDateText: string;
  remark: string;
};

export function normalizeSupplierPurchaseOrderResponse(
  input: unknown,
  currentDeliveryDate: DateValue,
): NormalizedSupplierPurchaseOrderResponse {
  if (!isPlainRecord(input)) {
    throw codedError("回复内容格式错误", 400, "SUPPLIER_PURCHASE_ORDER_RESPONSE_INVALID");
  }
  const action = String(input.action || "") as SupplierResponseAction;
  if (!(["ACCEPTED", "DELIVERY_PROPOSED", "REJECTED"] as string[]).includes(action)) {
    throw codedError("请选择有效的回复操作", 400, "SUPPLIER_PURCHASE_ORDER_ACTION_INVALID");
  }
  const expectedRevision = input.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw codedError("采购单版本号无效，请刷新后重试", 400, "SUPPLIER_PURCHASE_ORDER_REVISION_INVALID");
  }
  const remark = boundedRemark(input.remark);
  if (action === "REJECTED") {
    if (!remark) throw codedError("拒绝采购单时必须填写原因", 400, "SUPPLIER_PURCHASE_ORDER_REJECT_REMARK_REQUIRED");
    return { action, expectedRevision, deliveryDate: null, deliveryDateText: "", remark };
  }
  const delivery = requiredDate(
    input.deliveryDate,
    action === "ACCEPTED" ? "接受采购单时必须确认交货日期" : "提出新交期时必须填写有效日期",
    action === "ACCEPTED"
      ? "SUPPLIER_PURCHASE_ORDER_ACCEPT_DATE_REQUIRED"
      : "SUPPLIER_PURCHASE_ORDER_PROPOSED_DATE_REQUIRED",
  );
  if (action === "DELIVERY_PROPOSED") {
    if (!remark) {
      throw codedError("提出新交期时必须填写说明", 400, "SUPPLIER_PURCHASE_ORDER_PROPOSED_REMARK_REQUIRED");
    }
    const currentDateText = isoDate(currentDeliveryDate)?.slice(0, 10) || "";
    if (delivery.text === currentDateText) {
      throw codedError("新交期必须不同于当前交期", 400, "SUPPLIER_PURCHASE_ORDER_PROPOSED_DATE_UNCHANGED");
    }
  }
  return {
    action,
    expectedRevision,
    deliveryDate: delivery.date,
    deliveryDateText: delivery.text,
    remark,
  };
}
