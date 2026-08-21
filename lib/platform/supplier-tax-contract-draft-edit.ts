import { Prisma } from "../generated/prisma/client.js";
import type { SupplierTaxContractDraft, SupplierTaxContractItemDraft } from "./supplier-tax-contract-draft";
import { codedError, nonEmpty } from "./shared-base-utils";
import { supplierTaxContractQuantityText } from "./supplier-tax-contract-values";

const MANUAL_AMOUNT_ISSUE_PREFIX = "人工修正后的商品金额合计";
const EDITABLE_ITEM_MATCH_ISSUE = /^采购第(\d+)行无法可靠匹配报关单商品/;

function resolvedByManualItemReview(issue: string, changedLineNumbers: Set<number>) {
  if (issue.startsWith(MANUAL_AMOUNT_ISSUE_PREFIX)) return true;
  const match = issue.match(EDITABLE_ITEM_MATCH_ISSUE);
  return match ? changedLineNumbers.has(Number(match[1])) : false;
}

export type SupplierTaxContractDraftEdit = {
  purchaseOrderItemId?: unknown;
  productName?: unknown;
  quantity?: unknown;
  unit?: unknown;
};

function editableText(value: unknown, label: string, maxLength: number) {
  const text = nonEmpty(value);
  if (!text) throw codedError(`${label}不能为空。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_REQUIRED");
  if (text.length > maxLength) throw codedError(`${label}不能超过${maxLength}个字符。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_TOO_LONG");
  return text;
}

function editableQuantity(value: unknown, lineNo: number) {
  const text = nonEmpty(value).replace(/[,，\s]/g, "");
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) {
    throw codedError(`第${lineNo}行数量必须是最多4位小数的正数。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_QUANTITY_INVALID");
  }
  const quantity = new Prisma.Decimal(text);
  if (!quantity.isPositive() || quantity.precision() > 18) {
    throw codedError(`第${lineNo}行数量超出允许范围。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_QUANTITY_RANGE");
  }
  return quantity;
}

function normalizedQuantity(value: Prisma.Decimal, source: unknown) {
  return supplierTaxContractQuantityText(value, source);
}

function changedFields(before: SupplierTaxContractItemDraft, after: SupplierTaxContractItemDraft) {
  return [
    before.productName !== after.productName ? "品名" : "",
    before.quantity !== after.quantity ? "数量" : "",
    before.unit !== after.unit ? "单位" : "",
  ].filter(Boolean);
}

export function applySupplierTaxContractDraftEdits(
  draft: SupplierTaxContractDraft,
  edits: SupplierTaxContractDraftEdit[],
  editedAt = new Date(),
) {
  if (!Array.isArray(edits) || edits.length !== draft.items.length) {
    throw codedError("必须完整提交合同中的全部商品行。", 400, "SUPPLIER_TAX_CONTRACT_EDIT_ITEMS_INCOMPLETE");
  }
  const editsById = new Map<string, SupplierTaxContractDraftEdit>();
  for (const edit of edits) {
    const itemId = nonEmpty(edit?.purchaseOrderItemId);
    if (!itemId || editsById.has(itemId)) {
      throw codedError("合同商品行存在缺失或重复。", 400, "SUPPLIER_TAX_CONTRACT_EDIT_ITEMS_DUPLICATE");
    }
    editsById.set(itemId, edit);
  }
  const changes: Array<{ lineNo: number; fields: string[] }> = [];
  const items = draft.items.map((before) => {
    const edit = editsById.get(before.purchaseOrderItemId);
    if (!edit) throw codedError(`合同第${before.lineNo}行缺失。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_ITEM_MISSING");
    const quantity = editableQuantity(edit.quantity, before.lineNo);
    const quantityText = normalizedQuantity(quantity, edit.quantity);
    const quantityForAmount = new Prisma.Decimal(quantityText);
    const unitPrice = new Prisma.Decimal(before.unitPriceWithTax);
    const after: SupplierTaxContractItemDraft = {
      ...before,
      productName: editableText(edit.productName, `第${before.lineNo}行品名`, 200),
      quantity: quantityText,
      unit: editableText(edit.unit, `第${before.lineNo}行单位`, 40),
      amountWithTax: quantityForAmount.mul(unitPrice).toDecimalPlaces(2).toFixed(2),
    };
    const fields = changedFields(before, after);
    if (fields.length) changes.push({ lineNo: before.lineNo, fields });
    return after;
  });
  if (editsById.size !== draft.items.length) {
    throw codedError("提交内容包含不属于当前合同的商品行。", 400, "SUPPLIER_TAX_CONTRACT_EDIT_ITEM_UNKNOWN");
  }
  const calculatedTotal = items.reduce(
    (sum, item) => sum.add(item.amountWithTax),
    new Prisma.Decimal(0),
  ).toDecimalPlaces(2);
  const expectedTotal = new Prisma.Decimal(draft.totalAmountWithTax);
  const changedLineNumbers = new Set(changes.map((change) => change.lineNo));
  const retainedBlockingIssues = (draft.blockingIssues || []).filter(
    (issue) => !resolvedByManualItemReview(issue, changedLineNumbers),
  );
  const blockingIssues = calculatedTotal.eq(expectedTotal)
    ? retainedBlockingIssues
    : [...new Set([
        ...retainedBlockingIssues,
        `人工修正后的商品金额合计${calculatedTotal.toFixed(2)}与采购结算金额${expectedTotal.toFixed(2)}不一致。`,
      ])];
  const warnings = changes.length
    ? [`OCR识别结果已人工修正（${changes.map((row) => `第${row.lineNo}行${row.fields.join("、")}`).join("；")}），请继续对照报关单原件核查。`]
    : ["人工已核查商品行，未修改OCR识别结果。"];
  return {
    draft: {
      ...draft,
      items,
      warnings,
      blockingIssues,
      manualEditedAt: editedAt.toISOString(),
    } satisfies SupplierTaxContractDraft,
    changes,
    calculatedTotal: calculatedTotal.toFixed(2),
  };
}
