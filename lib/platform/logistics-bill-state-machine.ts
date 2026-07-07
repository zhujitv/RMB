export const LOGISTICS_BILL_PAY_BUTTON_RULE = {
  allow: ["审核通过 + 已上传发票 + 未付款"],
  deny: ["草稿", "待审核", "未上传发票", "已付款"],
} as const;

export const LOGISTICS_BILL_PAY_DISABLED_TOOLTIP = "需审核通过且已上传发票后才可标记付款";

export type LogisticsBillAuditStatus = "草稿" | "待审核" | "审核通过" | "已驳回";
export type LogisticsBillInvoiceStatus = "待开票" | "待开票 / 通知失败" | "部分上传发票" | "已上传发票";
export type LogisticsBillPaymentStatus = "待开票" | "待付款" | "部分付款" | "已付款";
export type LogisticsBillDefaultTab = "basic" | "details" | "invoice" | "history";

export type LogisticsBillStateInput = {
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  costSynced?: boolean | null;
  hasInvoiceDocument?: boolean | null;
};

export type LogisticsBillState = {
  auditStatus: LogisticsBillAuditStatus;
  invoiceStatus: LogisticsBillInvoiceStatus;
  paymentStatus: LogisticsBillPaymentStatus;
  alreadyPaid: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canReview: boolean;
  canEditDetails: boolean;
  canDeleteDetails: boolean;
  canUploadInvoice: boolean;
  canMarkPaid: boolean;
};

export function normalizeLogisticsBillAuditStatus(value: unknown): LogisticsBillAuditStatus {
  const text = String(value || "").trim();
  if (text.includes("待审核")) return "待审核";
  if (text.includes("审核通过")) return "审核通过";
  if (text.includes("驳回")) return "已驳回";
  return "草稿";
}

export function normalizeLogisticsBillInvoiceStatus(value: unknown): LogisticsBillInvoiceStatus {
  const text = String(value || "").trim();
  if (text.includes("通知失败")) return "待开票 / 通知失败";
  if (text.includes("部分")) return "部分上传发票";
  if (text.includes("已确认") || text.includes("已上传") || text.includes("已开票")) return "已上传发票";
  return "待开票";
}

export function normalizeLogisticsBillPaymentStatus(value: unknown): LogisticsBillPaymentStatus {
  const text = String(value || "").trim();
  if (text.includes("已付款")) return "已付款";
  if (text.includes("部分")) return "部分付款";
  if (text.includes("待付款") || text.includes("已开票")) return "待付款";
  return "待开票";
}

export function logisticsBillState(input: LogisticsBillStateInput = {}): LogisticsBillState {
  const auditStatus = normalizeLogisticsBillAuditStatus(input.auditStatus);
  const invoiceStatus = normalizeLogisticsBillInvoiceStatus(input.invoiceStatus);
  const paymentStatus = normalizeLogisticsBillPaymentStatus(input.paymentStatus);
  const alreadyPaid = paymentStatus === "已付款";
  const costSynced = Boolean(input.costSynced);
  return {
    auditStatus,
    invoiceStatus,
    paymentStatus,
    alreadyPaid,
    canSubmit: canSubmitLogisticsBill(input),
    canWithdraw: canWithdrawLogisticsBill(input),
    canReview: canReviewLogisticsBill(input),
    canEditDetails: !logisticsBillEditBlockReason({ ...input, costSynced }),
    canDeleteDetails: !logisticsBillDeleteBlockReason({ ...input, costSynced }),
    canUploadInvoice: canUploadLogisticsBillInvoice(input),
    canMarkPaid: canMarkLogisticsBillPaid(input),
  };
}

export function canSubmitLogisticsBill(input: LogisticsBillStateInput = {}) {
  return ["草稿", "已驳回"].includes(normalizeLogisticsBillAuditStatus(input.auditStatus));
}

export function canWithdrawLogisticsBill(input: LogisticsBillStateInput = {}) {
  return normalizeLogisticsBillAuditStatus(input.auditStatus) === "待审核";
}

export function canReviewLogisticsBill(input: LogisticsBillStateInput = {}) {
  return normalizeLogisticsBillAuditStatus(input.auditStatus) === "待审核";
}

export function canApproveLogisticsBill(input: LogisticsBillStateInput = {}) {
  return canReviewLogisticsBill(input);
}

export function canRejectLogisticsBill(input: LogisticsBillStateInput = {}) {
  return canReviewLogisticsBill(input);
}

export function canUploadLogisticsBillInvoice(input: LogisticsBillStateInput = {}) {
  return ["待审核", "审核通过"].includes(normalizeLogisticsBillAuditStatus(input.auditStatus));
}

export function canMarkLogisticsBillPaid(input: LogisticsBillStateInput = {}) {
  return normalizeLogisticsBillAuditStatus(input.auditStatus) === "审核通过"
    && normalizeLogisticsBillInvoiceStatus(input.invoiceStatus) === "已上传发票"
    && normalizeLogisticsBillPaymentStatus(input.paymentStatus) !== "已付款";
}

export function logisticsBillDefaultTab(input: LogisticsBillStateInput = {}): LogisticsBillDefaultTab {
  const auditStatus = normalizeLogisticsBillAuditStatus(input.auditStatus);
  const invoiceStatus = normalizeLogisticsBillInvoiceStatus(input.invoiceStatus);
  const paymentStatus = normalizeLogisticsBillPaymentStatus(input.paymentStatus);
  if (["草稿", "已驳回"].includes(auditStatus)) return "details";
  if (auditStatus === "待审核") return "basic";
  if (auditStatus === "审核通过") return "invoice";
  if (["待开票", "待开票 / 通知失败", "部分上传发票", "已上传发票"].includes(invoiceStatus)) return "invoice";
  if (["已付款", "部分付款"].includes(paymentStatus)) return "invoice";
  return "details";
}

export function logisticsBillEditBlockReason(input: LogisticsBillStateInput = {}) {
  const auditStatus = normalizeLogisticsBillAuditStatus(input.auditStatus);
  const invoiceText = String(input.invoiceStatus || "").trim();
  const paymentText = String(input.paymentStatus || "").trim();
  if (input.costSynced) return "该费用已同步到成本，不能修改。";
  if (auditStatus === "审核通过") return "已审核，不能修改。";
  if (auditStatus === "待审核") return "待审核账单不能修改，请先撤回为草稿。";
  if (invoiceText.includes("已上传") || invoiceText.includes("已确认")) return "已开票，不能修改。";
  if (paymentText.includes("已开票") || paymentText.includes("待付款") || paymentText.includes("已付款")) return "已付款流程中，不能修改。";
  if (!["草稿", "已驳回"].includes(auditStatus)) return "当前状态不能修改。";
  return "";
}

export function logisticsBillDeleteBlock(input: LogisticsBillStateInput = {}) {
  const auditStatus = normalizeLogisticsBillAuditStatus(input.auditStatus);
  const invoiceStatus = normalizeLogisticsBillInvoiceStatus(input.invoiceStatus);
  const invoiceText = String(input.invoiceStatus || "").trim();
  const paymentStatus = normalizeLogisticsBillPaymentStatus(input.paymentStatus);
  const paymentText = String(input.paymentStatus || "").trim();
  if (input.costSynced) {
    return { message: "已同步成本：请先取消成本同步。", code: "LOGISTICS_EXPENSE_SYNCED_COST_DELETE_BLOCKED" };
  }
  if (invoiceText.includes("已确认") || invoiceStatus === "已上传发票" && invoiceText.includes("确认")) {
    return { message: "已确认发票：不允许删除。", code: "LOGISTICS_EXPENSE_CONFIRMED_INVOICE_DELETE_BLOCKED" };
  }
  if (input.hasInvoiceDocument || invoiceStatus === "已上传发票" || invoiceStatus === "部分上传发票" || invoiceText.includes("已上传")) {
    return { message: "已上传发票：请先删除已上传发票。", code: "LOGISTICS_EXPENSE_INVOICED_DELETE_BLOCKED" };
  }
  if (paymentStatus === "已付款" || paymentStatus === "部分付款" || paymentText.includes("已付款")) {
    return { message: "已付款：不允许删除。", code: "LOGISTICS_EXPENSE_PAID_DELETE_BLOCKED" };
  }
  if (auditStatus === "审核通过") {
    return { message: "审核通过：请先撤回审核。", code: "LOGISTICS_EXPENSE_APPROVED_DELETE_BLOCKED" };
  }
  if (auditStatus === "待审核") {
    return { message: "审核状态不是草稿：请先撤回审核。", code: "LOGISTICS_EXPENSE_PENDING_DELETE_BLOCKED" };
  }
  if (auditStatus === "已驳回") {
    return { message: "审核状态不是草稿：请先恢复为草稿。", code: "LOGISTICS_EXPENSE_REJECTED_DELETE_BLOCKED" };
  }
  if (auditStatus !== "草稿") {
    return { message: "审核状态不是草稿：请先撤回审核。", code: "LOGISTICS_EXPENSE_DELETE_STATUS_BLOCKED" };
  }
  if (invoiceStatus !== "待开票") {
    return { message: "发票状态不是待开票：请先删除已上传发票或恢复待开票状态。", code: "LOGISTICS_EXPENSE_INVOICE_STATUS_DELETE_BLOCKED" };
  }
  if (!["待开票", "未付款"].includes(paymentStatus) && paymentText !== "未付款") {
    return { message: "付款状态不是未付款：不允许删除。", code: "LOGISTICS_EXPENSE_PAYMENT_STATUS_DELETE_BLOCKED" };
  }
  return null;
}

export function logisticsBillDeleteBlockReason(input: LogisticsBillStateInput = {}) {
  return logisticsBillDeleteBlock(input)?.message || "";
}

export function logisticsBillPayState(input: LogisticsBillStateInput = {}) {
  const state = logisticsBillState(input);
  return {
    auditStatus: state.auditStatus,
    invoiceStatus: state.invoiceStatus,
    paymentStatus: state.paymentStatus,
    alreadyPaid: state.alreadyPaid,
    canMarkPaid: state.canMarkPaid,
    rule: LOGISTICS_BILL_PAY_BUTTON_RULE,
  };
}
