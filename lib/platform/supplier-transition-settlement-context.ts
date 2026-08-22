import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import { assertBusinessNotArchived } from "./business-archive";
import { FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE } from "./factory-purchase-transition-settlement-values";
import { assertWrite } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { FACTORY_SUPPLIER_COST_TYPES } from "./shared-cost-constants";
import { recognizeTencentCustomsGoods } from "./tencent-customs-ocr-experiment";
import type { ActorLike } from "./supplier-document-request-types";
import { customsQuantityKey, customsUnitKey } from "./supplier-tax-contract-customs-match";

export { FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE } from "./factory-purchase-transition-settlement-values";

export type TransitionItemInput = {
  customsItemIndex?: unknown;
  productName?: unknown;
  unit?: unknown;
  quantity?: unknown;
  quantityOptionIndex?: unknown;
};

export type TransitionInput = {
  items?: unknown;
  increaseAmount?: unknown;
  decreaseAmount?: unknown;
  reason?: unknown;
  confirmed?: unknown;
};

export function dateText(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export function decimalText(value: Prisma.Decimal, places: number) {
  return value.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
}

export function positiveDecimal(value: unknown, label: string, places: number) {
  const text = nonEmpty(value).replace(/[,，\s]/g, "");
  const pattern = places === 4 ? /^\d+(?:\.\d{1,4})?$/ : /^\d+(?:\.\d{1,6})?$/;
  if (!pattern.test(text)) throw codedError(`${label}必须是有效正数。`, 400, "FACTORY_TRANSITION_DECIMAL_INVALID");
  const result = new Prisma.Decimal(text);
  if (!result.gt(0) || result.precision() > 18) throw codedError(`${label}超出允许范围。`, 400, "FACTORY_TRANSITION_DECIMAL_RANGE");
  return result;
}

export function nonNegativeMoney(value: unknown, label: string) {
  const text = nonEmpty(value || "0").replace(/[,，\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw codedError(`${label}必须是最多两位小数的非负数。`, 400, "FACTORY_TRANSITION_MONEY_INVALID");
  return new Prisma.Decimal(text).toDecimalPlaces(2);
}

export function customsQuantity(candidate: Record<string, unknown>) {
  const rows = Array.isArray(candidate.quantityUnits) ? candidate.quantityUnits as Array<Record<string, unknown>> : [];
  return rows[0] || {};
}

function comparable(value: unknown) {
  return String(value || "").toUpperCase().replace(/[\s（）()【】\[\]，,。._\-\/\\]/g, "");
}

export function customsQuantityForSelection(candidate: Record<string, unknown>, unit: unknown, quantity: unknown, optionIndex?: unknown) {
  const rows = Array.isArray(candidate.quantityUnits) ? candidate.quantityUnits as Array<Record<string, unknown>> : [];
  const indexed = Number(optionIndex);
  if (Number.isInteger(indexed) && indexed >= 0 && rows[indexed]) return rows[indexed];
  const unitKey = customsUnitKey(unit);
  const quantityKey = customsQuantityKey(quantity);
  return rows.find((row) => customsUnitKey(row.unit) === unitKey && customsQuantityKey(row.quantity) === quantityKey)
    || rows.find((row) => customsUnitKey(row.unit) === unitKey)
    || (unitKey ? { quantity: nonEmpty(quantity), unit: nonEmpty(unit) } : null)
    || rows[0]
    || {};
}

function decimalComparable(value: unknown) {
  return customsQuantityKey(value);
}

function bestQuantityOption(
  candidate: Record<string, unknown>,
  quantityOptions: Array<{ index: number; quantity: string; unit: string }>,
  references: Array<{ productName?: unknown; unit?: unknown; quantity?: unknown }>,
) {
  if (!quantityOptions.length || !references.length) return quantityOptions[0] || null;
  const productKey = comparable(candidate.productName || candidate.nameAndSpecification);
  const scored = quantityOptions.flatMap((option) => references.map((reference) => {
    const referenceQuantity = decimalComparable(reference.quantity);
    const sameQuantity = referenceQuantity && decimalComparable(option.quantity) === referenceQuantity;
    const referenceUnit = customsUnitKey(reference.unit);
    const sameUnit = customsUnitKey(option.unit) === referenceUnit;
    const referenceProduct = comparable(reference.productName);
    const sameProduct = productKey && referenceProduct && (productKey === referenceProduct || productKey.includes(referenceProduct) || referenceProduct.includes(productKey));
    return {
      option,
      score: (sameQuantity && sameUnit ? 120 : sameQuantity && !referenceUnit ? 70 : 0) + (sameProduct ? 30 : 0) + (sameUnit ? 10 : 0),
    };
  }));
  return scored.sort((left, right) => right.score - left.score)[0]?.score > 0
    ? scored.sort((left, right) => right.score - left.score)[0]?.option || quantityOptions[0]
    : quantityOptions[0];
}

export function selectableCustomsItems(
  candidates: Array<Record<string, unknown>>,
  references: Array<{ productName?: unknown; unit?: unknown; quantity?: unknown }> = [],
) {
  return candidates.flatMap((candidate, customsItemIndex) => {
    const productName = nonEmpty(candidate.productName);
    const quantityOptions = (Array.isArray(candidate.quantityUnits) ? candidate.quantityUnits as Array<Record<string, unknown>> : [])
      .map((row, index) => ({ index, quantity: nonEmpty(row.quantity), unit: nonEmpty(row.unit) }))
      .filter((row) => row.quantity && row.unit);
    const quantity = bestQuantityOption(candidate, quantityOptions, references) || customsQuantity(candidate);
    const unit = nonEmpty(quantity.unit);
    const quantityValue = nonEmpty(quantity.quantity);
    if (!productName || !unit || !quantityValue) return [];
    const quantityOptionIndex = Number.isInteger(Number(quantity.index)) ? Number(quantity.index) : 0;
    return [{ customsItemIndex, productName, unit, quantity: quantityValue, quantityOptionIndex, quantityOptions }];
  });
}

export function parsedItems(value: unknown): TransitionItemInput[] {
  const raw = typeof value === "string" ? (() => {
    try { return JSON.parse(value); } catch { return null; }
  })() : value;
  if (!Array.isArray(raw) || !raw.length) {
    throw codedError("请至少选择一行报关商品并确认品名、数量和单位。", 400, "FACTORY_TRANSITION_ITEMS_REQUIRED");
  }
  return raw as TransitionItemInput[];
}

export async function loadTransitionContext(costId: string) {
  const cost = await prisma.orderCost.findFirst({
    where: { id: costId, deletedAt: null, status: "ACTIVE" },
    include: {
      transitionSettlements: {
        where: { revokedAt: null },
        orderBy: { confirmedAt: "desc" },
        take: 1,
      },
      supplier: true,
      order: {
        include: {
          businessEntity: true,
          sourceSalesExecution: {
            include: {
              items: { orderBy: [{ lineNumber: "asc" }] },
            },
          },
        },
      },
    },
  });
  if (!cost || !cost.supplierId || !cost.supplier || !cost.order) throw codedError("请选择有效的工厂供应商成本。", 404, "FACTORY_TRANSITION_COST_NOT_FOUND");
  if (!FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType)) throw codedError("只有工厂货款类成本可以创建过渡结算。", 400, "FACTORY_TRANSITION_COST_TYPE_REQUIRED");
  if (!cost.costConfirmed) throw codedError("请先在成本管理确认该工厂成本。", 409, "FACTORY_TRANSITION_COST_CONFIRMATION_REQUIRED");
  if (!["MANUAL", FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE].includes(cost.sourceType || "MANUAL")) throw codedError("该成本已由其它业务流程管理，不能创建过渡结算。", 409, "FACTORY_TRANSITION_COST_SOURCE_CONFLICT");
  if (cost.sourceType === "MANUAL" && cost.sourceId) throw codedError("该手工成本已关联其它来源，不能转为过渡结算。", 409, "FACTORY_TRANSITION_MANUAL_SOURCE_CONFLICT");
  assertBusinessNotArchived(cost.order, "该订单已提交退税或归档，不能补建过渡结算。");
  if (!cost.order.actualShipmentDate && !cost.order.blDate && !cost.order.customsDeclarationDate) throw codedError("该订单缺少实际发货、提单或报关日期，不能作为已发货过渡订单。", 409, "FACTORY_TRANSITION_SHIPMENT_EVIDENCE_REQUIRED");
  if (!cost.order.customsDeclarationNo) throw codedError("请先在退税资料中确认报关单号。", 409, "FACTORY_TRANSITION_CUSTOMS_DECLARATION_REQUIRED");
  if (!cost.order.businessEntity) throw codedError("订单未关联业务主体，不能生成退税合同。", 409, "FACTORY_TRANSITION_BUSINESS_ENTITY_REQUIRED");
  const customsDocument = await prisma.orderDocument.findFirst({
    where: { orderId: cost.orderId, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS", deletedAt: null },
    orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!customsDocument?.storageKey) throw codedError("请先在退税资料上传有效报关单 PDF。", 400, "CUSTOMS_DOCUMENT_REQUIRED");
  return { cost, customsDocument };
}

export async function recognizedCustoms(
  storageKey: string,
  fallbackItems: Array<{ productName?: unknown; unit?: unknown; quantity?: unknown }> = [],
) {
  try {
    return await recognizeTencentCustomsGoods(await readR2Object(storageKey));
  } catch (error) {
    const items = (fallbackItems.length ? fallbackItems : [{}]).map((item, index) => ({
      itemNo: String(index + 1),
      productName: nonEmpty(item.productName),
      nameAndSpecification: nonEmpty(item.productName),
      commodityCode: "",
      quantityUnits: nonEmpty(item.quantity) && nonEmpty(item.unit)
        ? [{ quantity: nonEmpty(item.quantity), unit: nonEmpty(item.unit) }]
        : [],
    }));
    return {
      provider: "TENCENT_CLOUD",
      apiName: "RecognizeTableAccurateOCR",
      requestIds: [],
      totalPages: 0,
      items,
      warnings: [`OCR未能完整预填报关商品：${error instanceof Error ? error.message : "识别失败"}。请由人工补录并核对原件。`],
    };
  }
}

export async function previewFactoryPurchaseTransitionSettlement(costId: string, actor: ActorLike) {
  if (actor?.role !== "管理员") throw codedError("只有管理员可以创建过渡结算。", 403, "FACTORY_TRANSITION_ADMIN_ONLY");
  assertWrite(actor, "supplierDocuments");
  const { cost, customsDocument } = await loadTransitionContext(costId);
  const transitionSettlement = cost.transitionSettlements[0];
  if (transitionSettlement) return {
    existing: true,
    customsDocumentId: transitionSettlement.customsDocumentId,
    increaseAmount: transitionSettlement.increaseAmount.toFixed(2),
    decreaseAmount: transitionSettlement.decreaseAmount.toFixed(2),
    reason: transitionSettlement.reason,
    items: transitionSettlement.itemSnapshot,
  };
  const orderQuantityReferences = cost.order.sourceSalesExecution?.items.map((item) => ({
    productName: item.productNameSnapshot,
    unit: item.unitSnapshot,
    quantity: item.quantity,
  })) || [];
  const customs = await recognizedCustoms(customsDocument.storageKey, orderQuantityReferences);
  const selectable = selectableCustomsItems(customs.items as Array<Record<string, unknown>>, orderQuantityReferences);
  return {
    existing: false,
    customsDocumentId: customsDocument.id,
    customsDeclarationNo: cost.order.customsDeclarationNo || "",
    finalPayableAmount: cost.amount.toFixed(2),
    currency: cost.currency,
    warnings: customs.warnings,
    items: (selectable.length ? selectable : [{ customsItemIndex: 0, productName: "", unit: "", quantity: "", quantityOptionIndex: null, quantityOptions: [] }])
      .map((item) => ({ ...item, selected: false })),
  };
}
