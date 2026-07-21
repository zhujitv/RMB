import { LOGISTICS_GENERATED_COST_SOURCE_TYPES } from "./logistics-generated-cost-source-types.ts";

const ORDER_COST_STATUS_VOID = "VOID";
const CLOSURE_LEGACY_COST_TYPE_LABELS: Record<string, string> = {
  国内物流费: "拖车费",
  国内拖车费: "拖车费",
  文件费: "港杂费",
  订舱费: "港杂费",
  ENS费: "ENS",
};

function normalizedClosureCostType(value: unknown) {
  const text = String(value || "").trim();
  return CLOSURE_LEGACY_COST_TYPE_LABELS[text] || text;
}

type ClosureDocumentLike = {
  id?: string | null;
  uploadStatus?: unknown;
  deletedAt?: Date | string | null;
} | null;

type ClosureBillLike = {
  id?: string | null;
  auditStatus?: unknown;
  invoiceStatus?: unknown;
  paymentStatus?: unknown;
  paymentDate?: Date | string | null;
  status?: string | null;
  deletedAt?: Date | string | null;
} | null;

type ClosureCostLike = {
  id?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  costType?: string | null;
  currency?: string | null;
  amount?: unknown;
  amountCny?: unknown;
  sourceType?: string | null;
  sourceId?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  paid?: boolean | null;
  paymentDate?: Date | string | null;
  status?: string | null;
  deletedAt?: Date | string | null;
} | null;

export type TaxRefundLogisticsClosureRow = {
  id: string;
  orderId?: string | null;
  supplierId?: string | null;
  costId?: string | null;
  costType?: string | null;
  amount?: unknown;
  amountCny?: unknown;
  currency?: string | null;
  supplierNameSnapshot?: string | null;
  auditStatus?: unknown;
  invoiceStatus?: unknown;
  paymentStatus?: unknown;
  invoiceDocumentId?: string | null;
  invoiceValidationStatus?: string | null;
  invoiceValidationMessage?: string | null;
  deletedAt?: Date | string | null;
  supplier?: { supplierName?: string | null } | null;
  bill?: ClosureBillLike;
  cost?: ClosureCostLike;
  invoiceDocument?: ClosureDocumentLike;
};

export type TaxRefundLogisticsClosureBlocker = {
  expenseId: string;
  label: string;
  reasons: string[];
};

function positiveAmount(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeAuditStatus(value: unknown) {
  const text = String(value || "").trim();
  if (text.includes("待审核")) return "待审核";
  if (text.includes("审核通过")) return "审核通过";
  if (text.includes("驳回")) return "已驳回";
  return "草稿";
}

function normalizePaymentStatus(value: unknown) {
  const text = String(value || "").trim();
  if (text.includes("部分")) return "部分付款";
  if (text.includes("已付款")) return "已付款";
  if (text.includes("待付款") || text.includes("已开票")) return "待付款";
  return "待开票";
}

function normalizeCostPaymentStatus(value: unknown) {
  const text = String(value || "").trim();
  if (text.includes("部分")) return "部分支付";
  if (text.includes("已支付") || text.includes("已付款")) return "已支付";
  return "待支付";
}

function moneyKey(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function dateKey(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function invoiceValidationPassed(value: unknown) {
  return ["校验通过", "人工确认通过"].includes(String(value || "").trim());
}

function closureRowLabel(row: TaxRefundLogisticsClosureRow) {
  const supplierName = String(row.supplierNameSnapshot || row.supplier?.supplierName || "未命名供应商").trim();
  const costType = String(row.costType || "物流费用").trim();
  const currency = String(row.currency || "CNY").trim().toUpperCase();
  const amount = positiveAmount(row.amount).toFixed(2);
  return `${costType}（${supplierName}，${currency} ${amount}）`;
}

function isActiveClosureRow(row: TaxRefundLogisticsClosureRow) {
  if (row.deletedAt || positiveAmount(row.amount) <= 0) return false;
  if (!row.bill) return true;
  return !row.bill.deletedAt && String(row.bill.status || "normal").trim() !== "voided";
}

export function analyzeTaxRefundLogisticsClosure(rows: TaxRefundLogisticsClosureRow[] = []) {
  const activeRows = rows.filter(isActiveClosureRow);
  const blockers = activeRows.flatMap<TaxRefundLogisticsClosureBlocker>((row) => {
    const auditStatus = normalizeAuditStatus(row.bill?.auditStatus ?? row.auditStatus);
    const paymentStatus = normalizePaymentStatus(row.bill?.paymentStatus ?? row.paymentStatus);
    const documentExists = Boolean(
      row.invoiceDocumentId
      && row.invoiceDocument?.id
      && !row.invoiceDocument.deletedAt
      && String(row.invoiceDocument.uploadStatus || "").trim() === "SUCCESS",
    );
    const reasons: string[] = [];
    if (auditStatus !== "审核通过") reasons.push(`审核状态为${auditStatus}`);
    if (!documentExists) reasons.push("物流发票未上传完整");
    if (documentExists && paymentStatus !== "已付款" && !invoiceValidationPassed(row.invoiceValidationStatus)) {
      const validationMessage = String(row.invoiceValidationMessage || "").trim();
      reasons.push(validationMessage || `发票校验状态为${row.invoiceValidationStatus || "未校验"}`);
    }
    if (paymentStatus !== "已付款") reasons.push(`付款状态为${paymentStatus}`);
    const cost = row.cost;
    const activeCostExists = Boolean(
      row.costId
      && cost
      && cost.id === row.costId
      && !cost.deletedAt
      && String(cost.status || "ACTIVE").trim() !== ORDER_COST_STATUS_VOID,
    );
    if (!activeCostExists) {
      reasons.push("成本管理中未生成对应成本");
    } else if (cost) {
      const linkMatches = LOGISTICS_GENERATED_COST_SOURCE_TYPES.includes(String(cost.sourceType || ""))
        && cost.sourceId === row.id;
      if (!linkMatches) reasons.push("成本来源关联异常");
      const fieldsMatch = cost.orderId === row.orderId
        && cost.supplierId === row.supplierId
        && normalizedClosureCostType(cost.costType) === normalizedClosureCostType(row.costType)
        && String(cost.currency || "CNY").trim().toUpperCase() === String(row.currency || "CNY").trim().toUpperCase()
        && moneyKey(cost.amount) === moneyKey(row.amount)
        && moneyKey(cost.amountCny) === moneyKey(row.amountCny);
      if (!fieldsMatch) reasons.push("成本金额、供应商或费用类型未同步");
      if (documentExists && String(cost.invoiceStatus || "").trim() !== "已收到") {
        reasons.push(`成本发票状态未同步（当前：${cost.invoiceStatus || "未收到"}）`);
      }
      if (paymentStatus === "已付款") {
        const costPaymentStatus = normalizeCostPaymentStatus(cost.paymentStatus);
        const paymentDateMatches = !row.bill?.paymentDate || dateKey(cost.paymentDate) === dateKey(row.bill.paymentDate);
        if (costPaymentStatus !== "已支付" || cost.paid !== true || !paymentDateMatches) {
          reasons.push(`成本付款状态未同步（当前：${costPaymentStatus}）`);
        }
      }
    }
    return reasons.length ? [{ expenseId: row.id, label: closureRowLabel(row), reasons }] : [];
  });
  return {
    activeExpenseCount: activeRows.length,
    complete: blockers.length === 0,
    blockers,
  };
}

export function taxRefundLogisticsClosureErrorMessage(blockers: TaxRefundLogisticsClosureBlocker[]) {
  const visible = blockers.slice(0, 8).map((blocker) => `${blocker.label}：${blocker.reasons.join("、")}`);
  const hiddenCount = Math.max(0, blockers.length - visible.length);
  const hiddenText = hiddenCount ? `；另有 ${hiddenCount} 项未完成` : "";
  return `物流费用尚未全部结清，不能提交退税：${visible.join("；")}${hiddenText}。请先在物流费用模块完成审核、发票和付款。`;
}
