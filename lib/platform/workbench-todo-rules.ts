export type WorkbenchTodoPriority = "urgent" | "important" | "normal";
export type WorkbenchTodoStatus = "DRAFT" | "BLOCKED" | "ACTIVE" | "DONE" | "CANCELLED" | "FINISHED" | "ARCHIVED";
export type LegacyWorkbenchTodoStatus = "pending" | "completed";
export type WorkbenchFlowStage =
  | "SALES_ORDER_CREATED"
  | "PURCHASE_ORDER_CREATED"
  | "SUPPLIER_DOCUMENT_REQUESTED"
  | "SUPPLIER_DOCUMENT_COMPLETED"
  | "LOGISTICS_INFO_COMPLETED"
  | "CUSTOMS_DOCUMENT_UPLOADED"
  | "LOGISTICS_COST_RECORDED"
  | "LOGISTICS_INVOICE_UPLOADED"
  | "LOGISTICS_COST_AUDITED"
  | "SUPPLIER_PAYMENT_COMPLETED"
  | "TAX_REFUND_READY"
  | "TAX_ARCHIVE_SUBMITTED"
  | "PROFIT_REVIEWED"
  | "COMMISSION_SETTLED";

export type WorkbenchTodoActivationRule = {
  flowStage: WorkbenchFlowStage;
  prerequisiteStage?: WorkbenchFlowStage | null;
  activationCondition: string;
};

export type WorkbenchTodoForSummary = {
  priority: WorkbenchTodoPriority;
  status?: WorkbenchTodoStatus | LegacyWorkbenchTodoStatus;
  dueAt?: string | null;
};

export type WorkbenchTodoSummary = {
  pending: number;
  todayDue: number;
  overdue: number;
  completed: number;
  total: number;
  urgent: number;
};

export function startOfChinaDay(now = new Date()) {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaTime = new Date(now.getTime() + chinaOffsetMs);
  return new Date(Date.UTC(chinaTime.getUTCFullYear(), chinaTime.getUTCMonth(), chinaTime.getUTCDate()) - chinaOffsetMs);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function todoPriorityFromDueAt(dueAt: Date | string | null | undefined, now = new Date()): WorkbenchTodoPriority {
  const due = dueAt ? new Date(dueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return "normal";
  const today = startOfChinaDay(now);
  if (due < addDays(today, 1)) return "urgent";
  if (due < addDays(today, 3)) return "important";
  return "normal";
}

export function isDueToday(dueAt: string | null | undefined, now = new Date()) {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  const today = startOfChinaDay(now);
  return due >= today && due < addDays(today, 1);
}

export function isOverdue(dueAt: string | null | undefined, now = new Date()) {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  return due < startOfChinaDay(now);
}

export const WORKBENCH_TODO_ACTIVATION_RULES: Record<string, WorkbenchTodoActivationRule> = {
  NEW_ORDER_REVIEW: {
    flowStage: "SALES_ORDER_CREATED",
    prerequisiteStage: null,
    activationCondition: "salesOrder.status in ['草稿','待审核']",
  },
  PURCHASE_ORDER_PENDING: {
    flowStage: "PURCHASE_ORDER_CREATED",
    prerequisiteStage: "SALES_ORDER_CREATED",
    activationCondition: "salesOrder.status in ['已确认','生产中'] AND no active product-supplier cost exists",
  },
  SUPPLIER_DOCUMENT_RETURN: {
    flowStage: "SUPPLIER_DOCUMENT_REQUESTED",
    prerequisiteStage: "PURCHASE_ORDER_CREATED",
    activationCondition: "supplierDocumentRequest exists AND deletedAt IS NULL AND status not in ['已完成','已关闭']",
  },
  SUPPLIER_DOCUMENT_RETURN_COMPLETED: {
    flowStage: "SUPPLIER_DOCUMENT_COMPLETED",
    prerequisiteStage: "SUPPLIER_DOCUMENT_REQUESTED",
    activationCondition: "supplierDocumentRequest.status == '已完成'",
  },
  LOGISTICS_INFO_MISSING: {
    flowStage: "LOGISTICS_INFO_COMPLETED",
    prerequisiteStage: "SUPPLIER_DOCUMENT_COMPLETED",
    activationCondition: "order has entered logistics stage AND logistics supplier assigned AND supplier document requests are complete",
  },
  BILL_OF_LADING_MISSING: {
    flowStage: "LOGISTICS_INFO_COMPLETED",
    prerequisiteStage: "SUPPLIER_DOCUMENT_COMPLETED",
    activationCondition: "logistics info exists AND logistics supplier assigned AND bill of lading is missing",
  },
  CONTAINER_NO_MISSING: {
    flowStage: "LOGISTICS_INFO_COMPLETED",
    prerequisiteStage: "SUPPLIER_DOCUMENT_COMPLETED",
    activationCondition: "logistics info exists AND logistics supplier assigned AND container number is missing",
  },
  LOGISTICS_FEE_ENTRY: {
    flowStage: "LOGISTICS_COST_RECORDED",
    prerequisiteStage: "LOGISTICS_INFO_COMPLETED",
    activationCondition: "logistics info is complete AND bill of lading or transport info exists AND no logistics expense exists",
  },
  LOGISTICS_FEE_REVIEW: {
    flowStage: "LOGISTICS_COST_AUDITED",
    prerequisiteStage: "LOGISTICS_COST_RECORDED",
    activationCondition: "logisticsBill.auditStatus == '待审核'",
  },
  LOGISTICS_FEE_REVIEW_COMPLETED: {
    flowStage: "LOGISTICS_COST_AUDITED",
    prerequisiteStage: "LOGISTICS_COST_RECORDED",
    activationCondition: "logisticsBill.auditStatus == '审核通过'",
  },
  LOGISTICS_INVOICE_UPLOAD: {
    flowStage: "LOGISTICS_INVOICE_UPLOADED",
    prerequisiteStage: "LOGISTICS_COST_AUDITED",
    activationCondition: "logisticsBill.auditStatus == '审核通过' AND invoiceStatus is waiting for upload AND paymentStatus != '已付款'",
  },
  LOGISTICS_INVOICE_UPLOAD_COMPLETED: {
    flowStage: "LOGISTICS_INVOICE_UPLOADED",
    prerequisiteStage: "LOGISTICS_COST_AUDITED",
    activationCondition: "logistics invoice has been uploaded",
  },
  LOGISTICS_PAYMENT_REGISTER: {
    flowStage: "SUPPLIER_PAYMENT_COMPLETED",
    prerequisiteStage: "LOGISTICS_COST_AUDITED",
    activationCondition: "logisticsBill.auditStatus == '审核通过' AND invoiceStatus is uploaded or confirmed AND paymentStatus != '已付款'",
  },
  LOGISTICS_PAYMENT_REGISTER_COMPLETED: {
    flowStage: "SUPPLIER_PAYMENT_COMPLETED",
    prerequisiteStage: "LOGISTICS_COST_AUDITED",
    activationCondition: "logisticsBill.paymentStatus == '已付款'",
  },
  CUSTOMER_PAYMENT_CONFIRMATION: {
    flowStage: "SALES_ORDER_CREATED",
    prerequisiteStage: "SALES_ORDER_CREATED",
    activationCondition: "customer payment exists AND payment.status == '待确认'",
  },
  CUSTOMER_PAYMENT_CONFIRMED: {
    flowStage: "SALES_ORDER_CREATED",
    prerequisiteStage: "SALES_ORDER_CREATED",
    activationCondition: "customer payment.status == '已到账'",
  },
  FACTORY_PAYMENT_REGISTER: {
    flowStage: "SUPPLIER_PAYMENT_COMPLETED",
    prerequisiteStage: "SUPPLIER_DOCUMENT_COMPLETED",
    activationCondition: "product-supplier cost exists AND payment is not fully registered",
  },
  FACTORY_PAYMENT_COMPLETED: {
    flowStage: "SUPPLIER_PAYMENT_COMPLETED",
    prerequisiteStage: "SUPPLIER_DOCUMENT_COMPLETED",
    activationCondition: "product-supplier payment has been registered",
  },
  PAYMENT_VOUCHER_UPLOAD: {
    flowStage: "SUPPLIER_PAYMENT_COMPLETED",
    prerequisiteStage: "SUPPLIER_PAYMENT_COMPLETED",
    activationCondition: "product-supplier cost is paid AND payment voucher is missing",
  },
  PAID_WITHOUT_PAYMENT_TIME: {
    flowStage: "SUPPLIER_PAYMENT_COMPLETED",
    prerequisiteStage: "SUPPLIER_PAYMENT_COMPLETED",
    activationCondition: "product-supplier cost is paid AND paidAt is missing",
  },
  TAX_REFUND_INCOMPLETE: {
    flowStage: "TAX_REFUND_READY",
    prerequisiteStage: "CUSTOMS_DOCUMENT_UPLOADED",
    activationCondition: "customs declaration document exists AND tax refund record is active AND completeness < 100",
  },
  TAX_TRUCKING_INVOICE_MISSING: {
    flowStage: "TAX_REFUND_READY",
    prerequisiteStage: "LOGISTICS_COST_AUDITED",
    activationCondition: "customs declaration document exists AND required logistics invoice is missing",
  },
  TAX_CUSTOMS_DECLARATION_MISSING: {
    flowStage: "CUSTOMS_DOCUMENT_UPLOADED",
    prerequisiteStage: "LOGISTICS_INFO_COMPLETED",
    activationCondition: "logistics info exists AND customs declaration document is missing",
  },
  TAX_PURCHASE_CONTRACT_MISSING: {
    flowStage: "TAX_REFUND_READY",
    prerequisiteStage: "SUPPLIER_DOCUMENT_COMPLETED",
    activationCondition: "customs declaration document exists AND supplier purchase contract is missing",
  },
  TAX_VAT_INVOICE_MISSING: {
    flowStage: "TAX_REFUND_READY",
    prerequisiteStage: "SUPPLIER_DOCUMENT_COMPLETED",
    activationCondition: "customs declaration document exists AND supplier VAT invoice is missing",
  },
  TAX_REFUND_READY_NOT_ARCHIVED: {
    flowStage: "TAX_ARCHIVE_SUBMITTED",
    prerequisiteStage: "TAX_REFUND_READY",
    activationCondition: "taxRefund.completeness == 100 AND taxRefund.archivedAt IS NULL",
  },
  TAX_REFUND_ARCHIVED: {
    flowStage: "TAX_ARCHIVE_SUBMITTED",
    prerequisiteStage: "TAX_REFUND_READY",
    activationCondition: "taxRefund.archivedAt IS NOT NULL",
  },
  PROFIT_COST_INCOMPLETE: {
    flowStage: "PROFIT_REVIEWED",
    prerequisiteStage: "LOGISTICS_COST_AUDITED",
    activationCondition: "order has entered profit review stage AND cost data is incomplete",
  },
  PROFIT_EXCEPTION_REVIEW: {
    flowStage: "PROFIT_REVIEWED",
    prerequisiteStage: "TAX_ARCHIVE_SUBMITTED",
    activationCondition: "costs are complete AND logistics costs are confirmed AND tax refund is settled or not required AND profit is below threshold",
  },
  COMMISSION_SETTLEMENT: {
    flowStage: "COMMISSION_SETTLED",
    prerequisiteStage: "PROFIT_REVIEWED",
    activationCondition: "customer payment is complete AND costs are confirmed AND tax archive is submitted or not required AND profit review is complete",
  },
  COMMISSION_SETTLED: {
    flowStage: "COMMISSION_SETTLED",
    prerequisiteStage: "PROFIT_REVIEWED",
    activationCondition: "commissionStatus in ['已结算','SETTLED']",
  },
  ETA_ARRIVAL_ALERT: {
    flowStage: "LOGISTICS_INFO_COMPLETED",
    prerequisiteStage: "LOGISTICS_INFO_COMPLETED",
    activationCondition: "shipment tracking exists AND ETA is overdue or soon arriving",
  },
  CONTAINER_TRACKING_EXCEPTION: {
    flowStage: "LOGISTICS_INFO_COMPLETED",
    prerequisiteStage: "LOGISTICS_INFO_COMPLETED",
    activationCondition: "shipment tracking exists AND sync failed or stale",
  },
  CONTAINER_TRACKING_SYNCED: {
    flowStage: "LOGISTICS_INFO_COMPLETED",
    prerequisiteStage: "LOGISTICS_INFO_COMPLETED",
    activationCondition: "shipment tracking synced today",
  },
};

export const DEFAULT_WORKBENCH_TODO_ACTIVATION_RULE: WorkbenchTodoActivationRule = {
  flowStage: "SALES_ORDER_CREATED",
  prerequisiteStage: null,
  activationCondition: "source-specific active business condition",
};

export function todoActivationRuleForType(type: string): WorkbenchTodoActivationRule {
  return WORKBENCH_TODO_ACTIVATION_RULES[type] || DEFAULT_WORKBENCH_TODO_ACTIVATION_RULE;
}

export function isActiveWorkbenchTodoStatus(status: WorkbenchTodoStatus | LegacyWorkbenchTodoStatus | null | undefined) {
  return !status || status === "ACTIVE" || status === "pending";
}

export function isCompletedWorkbenchTodoStatus(status: WorkbenchTodoStatus | LegacyWorkbenchTodoStatus | null | undefined) {
  return status === "DONE" || status === "ARCHIVED" || status === "completed";
}

export function canActivateTodo<T extends { status?: WorkbenchTodoStatus | LegacyWorkbenchTodoStatus | null }>(todo: T) {
  return todo.status === "ACTIVE";
}

export function summarizeWorkbenchTodos<T extends WorkbenchTodoForSummary>(todos: T[], completed = 0, now = new Date()): WorkbenchTodoSummary {
  const pending = todos.filter((todo) => isActiveWorkbenchTodoStatus(todo.status));
  return {
    pending: pending.length,
    todayDue: pending.filter((todo) => isDueToday(todo.dueAt, now)).length,
    overdue: pending.filter((todo) => isOverdue(todo.dueAt, now)).length,
    completed,
    total: pending.length,
    urgent: pending.filter((todo) => todo.priority === "urgent").length,
  };
}
