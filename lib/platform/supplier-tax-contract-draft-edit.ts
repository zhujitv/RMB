import { Prisma } from "../generated/prisma/client.js";
import type { SupplierTaxContractDraft, SupplierTaxContractItemDraft } from "./supplier-tax-contract-draft";
import { codedError, nonEmpty } from "./shared-base-utils";
import { supplierTaxContractQuantityText } from "./supplier-tax-contract-values";

const MANUAL_AMOUNT_ISSUE_PREFIX = "人工修正后的商品金额合计";
const EDITABLE_ITEM_MATCH_ISSUE = /^采购第(\d+)行无法可靠匹配报关单商品/;
const EDITABLE_FIELDS = [
  "productName",
  "quantity",
  "unit",
  "unitPriceWithTax",
  "amountWithTax",
] as const;

type EditableField = typeof EDITABLE_FIELDS[number];

export type SupplierTaxContractDraftEdit = {
  rowId?: unknown;
  purchaseOrderItemId?: unknown;
  productName?: unknown;
  quantity?: unknown;
  unit?: unknown;
  unitPriceWithTax?: unknown;
  amountWithTax?: unknown;
};

type FieldChange = { field: EditableField; before: string; after: string };
type RowChange = {
  rowId: string;
  lineNo: number;
  action: "ADDED" | "UPDATED" | "REMOVED";
  fields: FieldChange[];
};

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = nonEmpty(value);
  if (!text) throw codedError(`${label}不能为空。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_REQUIRED");
  if (text.length > maxLength) throw codedError(`${label}不能超过${maxLength}个字符。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_TOO_LONG");
  return text;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  const text = nonEmpty(value);
  if (text.length > maxLength) throw codedError(`${label}不能超过${maxLength}个字符。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_TOO_LONG");
  return text;
}

function decimal(value: unknown, label: string, scale: number, maxPrecision: number) {
  const text = nonEmpty(value).replace(/[￥¥,，\s]/g, "").replace(/．/g, ".");
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(text)) {
    throw codedError(`${label}必须是最多${scale}位小数的正数。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_NUMBER_INVALID");
  }
  const valueDecimal = new Prisma.Decimal(text);
  if (!valueDecimal.isPositive() || valueDecimal.precision() > maxPrecision) {
    throw codedError(`${label}超出允许范围。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_NUMBER_RANGE");
  }
  return valueDecimal;
}

function compactDecimal(value: Prisma.Decimal, scale: number) {
  const fixed = value.toDecimalPlaces(scale).toFixed(scale);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

function itemRowId(item: Pick<SupplierTaxContractItemDraft, "rowId" | "purchaseOrderItemId" | "lineNo">) {
  return nonEmpty(item.rowId) || nonEmpty(item.purchaseOrderItemId) || `line:${item.lineNo}`;
}

function submittedRowId(edit: SupplierTaxContractDraftEdit, index: number) {
  const rowId = nonEmpty(edit.rowId) || nonEmpty(edit.purchaseOrderItemId) || `manual:${index + 1}`;
  if (!/^[\p{L}\p{N}:_.-]{1,200}$/u.test(rowId)) {
    throw codedError(`第${index + 1}行标识无效。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_ROW_ID_INVALID");
  }
  return rowId;
}

function fieldChanges(before: SupplierTaxContractItemDraft | null, after: SupplierTaxContractItemDraft) {
  return EDITABLE_FIELDS.flatMap((field): FieldChange[] => {
    const oldValue = before ? String(before[field] || "") : "";
    const newValue = String(after[field] || "");
    return oldValue === newValue ? [] : [{ field, before: oldValue, after: newValue }];
  });
}

function originalItems(draft: SupplierTaxContractDraft) {
  const source = draft.ocrOriginalItems?.length ? draft.ocrOriginalItems : draft.items;
  return source.map((item) => ({ ...item, rowId: itemRowId(item) }));
}

export function applySupplierTaxContractDraftEdits(
  draft: SupplierTaxContractDraft,
  edits: SupplierTaxContractDraftEdit[],
  editedAt = new Date(),
) {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 200) {
    throw codedError("合同商品行必须为1至200行。", 400, "SUPPLIER_TAX_CONTRACT_EDIT_ITEMS_INVALID");
  }
  const beforeById = new Map(draft.items.map((item) => [itemRowId(item), item]));
  const seen = new Set<string>();
  const changes: RowChange[] = [];
  const arithmeticWarnings: string[] = [];
  const items = edits.map((edit, index): SupplierTaxContractItemDraft => {
    const rowId = submittedRowId(edit, index);
    if (seen.has(rowId)) {
      throw codedError(`第${index + 1}行标识重复。`, 400, "SUPPLIER_TAX_CONTRACT_EDIT_ITEMS_DUPLICATE");
    }
    seen.add(rowId);
    const before = beforeById.get(rowId) || null;
    const lineNo = index + 1;
    const quantity = decimal(edit.quantity, `第${index + 1}行数量`, 4, 18);
    const unitPriceInput = edit.unitPriceWithTax ?? before?.unitPriceWithTax;
    const unitPrice = decimal(unitPriceInput, `第${index + 1}行含税单价`, 6, 18);
    const amountInput = edit.amountWithTax ?? (before
      ? quantity.mul(unitPrice).toDecimalPlaces(2).toFixed(2)
      : undefined);
    const amount = decimal(amountInput, `第${index + 1}行含税金额`, 2, 18).toDecimalPlaces(2);
    const calculated = quantity.mul(unitPrice).toDecimalPlaces(2);
    if (!calculated.eq(amount)) {
      arithmeticWarnings.push(`第${index + 1}行人工金额${amount.toFixed(2)}与数量×含税单价${calculated.toFixed(2)}不同，请确认分摊依据。`);
    }
    const after: SupplierTaxContractItemDraft = {
      ...(before || {}),
      rowId,
      lineNo,
      purchaseOrderItemId: before?.purchaseOrderItemId || `manual:${rowId}`,
      customsItemNo: optionalText(before?.customsItemNo || String(lineNo), `第${index + 1}行项号`, 40),
      customsCommodityCode: optionalText(before?.customsCommodityCode, `第${index + 1}行HS编码`, 40),
      productName: requiredText(edit.productName, `第${index + 1}行品名`, 200),
      quantity: supplierTaxContractQuantityText(quantity, edit.quantity),
      declaredQuantity: before?.declaredQuantity || supplierTaxContractQuantityText(quantity, edit.quantity),
      unit: requiredText(edit.unit, `第${index + 1}行单位`, 40),
      unitPriceWithTax: compactDecimal(unitPrice, 6),
      amountWithTax: amount.toFixed(2),
    };
    const fields = fieldChanges(before, after);
    if (fields.length) changes.push({ rowId, lineNo, action: before ? "UPDATED" : "ADDED", fields });
    return after;
  });
  for (const [rowId, before] of beforeById) {
    if (!seen.has(rowId)) {
      changes.push({
        rowId,
        lineNo: before.lineNo,
        action: "REMOVED",
        fields: EDITABLE_FIELDS.map((field) => ({ field, before: String(before[field] || ""), after: "" })),
      });
    }
  }
  const calculatedTotal = items.reduce((sum, item) => sum.add(item.amountWithTax), new Prisma.Decimal(0)).toDecimalPlaces(2);
  const expectedTotal = new Prisma.Decimal(draft.totalAmountWithTax);
  const reviewedOriginalLineNos = new Set(draft.items.map((item) => item.lineNo));
  const retainedBlockingIssues = (draft.blockingIssues || []).filter((issue) => {
    if (issue.startsWith(MANUAL_AMOUNT_ISSUE_PREFIX)) return false;
    const match = issue.match(EDITABLE_ITEM_MATCH_ISSUE);
    return !match || !reviewedOriginalLineNos.has(Number(match[1]));
  });
  const blockingIssues = calculatedTotal.eq(expectedTotal)
    ? retainedBlockingIssues
    : [...retainedBlockingIssues, `人工修正后的商品金额合计${calculatedTotal.toFixed(2)}与采购结算金额${expectedTotal.toFixed(2)}不一致。`];
  const manualMessage = changes.length
    ? `OCR识别结果已人工修正（新增${changes.filter((row) => row.action === "ADDED").length}行、修改${changes.filter((row) => row.action === "UPDATED").length}行、删除${changes.filter((row) => row.action === "REMOVED").length}行），后续以人工保存值为准。`
    : "人工已逐行核查OCR预填结果，未修改内容。";
  return {
    draft: {
      ...draft,
      items,
      ocrOriginalItems: originalItems(draft),
      warnings: [...new Set([...(draft.warnings || []), manualMessage, ...arithmeticWarnings])],
      blockingIssues: [...new Set(blockingIssues)],
      manualEditedAt: editedAt.toISOString(),
    } satisfies SupplierTaxContractDraft,
    changes,
    calculatedTotal: calculatedTotal.toFixed(2),
  };
}
