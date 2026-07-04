import type { Prisma } from "../generated/prisma/client.js";
import { PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE, includeOrderRelations, normalizeDateText } from "./shared";
import type { WorkbenchFlowStage, WorkbenchTodoPriority, WorkbenchTodoStatus, WorkbenchTodoSummary } from "./workbench-todo-rules";

export type { WorkbenchFlowStage, WorkbenchTodoPriority, WorkbenchTodoStatus, WorkbenchTodoSummary } from "./workbench-todo-rules";
export type WorkbenchTodoOwnerRole = "LOGISTICS_SUPPLIER" | "SALESPERSON" | "ADMIN" | "FINANCE" | "PURCHASE" | "PRODUCT_SUPPLIER";
export type WorkbenchTodo = {
  id: string;
  type: string;
  title: string;
  module: string;
  flowStage: WorkbenchFlowStage;
  prerequisiteStage?: WorkbenchFlowStage | null;
  activationCondition: string;
  orderId?: string;
  orderNo?: string;
  customerShortName?: string;
  priority: WorkbenchTodoPriority;
  status: WorkbenchTodoStatus;
  dueAt?: string | null;
  ownerUserId?: string | null;
  ownerUserIds?: string[];
  ownerName?: string;
  ownerRole?: WorkbenchTodoOwnerRole;
  visibleToUserIds: string[];
  isMine: boolean;
  action: {
    label: string;
    href: string;
  };
  createdAt?: string | null;
  updatedAt?: string | null;
};
export type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

export type TodoOrder = {
  id: string;
  orderNo: string;
  blNo?: string | null;
  status?: string | null;
  customerNameSnapshot?: string | null;
  dueDate?: Date | string | null;
  expectedShipmentDate?: Date | string | null;
  expectedArrivalDate?: Date | string | null;
  actualShipmentDate?: Date | string | null;
  blDate?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  taxRefundCompletenessUpdatedAt?: Date | string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxSubmittedAt?: Date | string | null;
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
  salespersonUserId?: string | null;
  customer?: { shortName?: string | null; salespersonUserId?: string | null } | null;
  salesperson?: { id?: string | null; name?: string | null; email?: string | null; role?: string | null } | null;
  logisticsSuppliers?: TodoLogisticsSupplierAssignment[] | null;
  supplierDocumentRequests?: Array<{ status?: string | null; supplierId?: string | null; costId?: string | null; completedAt?: Date | string | null; deletedAt?: Date | string | null }> | null;
  documents?: Array<{ documentType?: string | null; uploadStatus?: string | null; relatedModule?: string | null; deletedAt?: Date | string | null }> | null;
};

export type TodoUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
};

export type TodoSupplier = {
  id?: string | null;
  supplierName?: string | null;
  supplierType?: string | null;
  email?: string | null;
  operatorUsers?: TodoUser[] | null;
};

export type TodoLogisticsSupplierAssignment = {
  supplierId?: string | null;
  supplier?: TodoSupplier | null;
};

export type TodoOwner = {
  ownerUserId?: string | null;
  ownerName?: string | null;
  ownerRole: WorkbenchTodoOwnerRole;
  ownerUserIds?: string[];
  visibleToUserIds?: string[];
};

export type WorkbenchTodoContext = {
  actor: ActorLike;
  actorUserId: string;
  users: TodoUser[];
  adminUserIds: string[];
  financeUsers: TodoUser[];
  taxRefundArchiveFinanceUsers: TodoUser[];
  taxRefundArchiveConfiguredOwnerUsers: TodoUser[];
  taxRefundArchiveCompanyOwnerUsersByKey: Map<string, TodoUser[]>;
  systemCompanyKeys: string[];
  purchaseUsers: TodoUser[];
  usersBySupplierId: Map<string, TodoUser[]>;
  paymentVoucherReminderStartDate: Date;
};

export const TODO_LIMIT_PER_SOURCE = 80;
export const WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS = [
  "workbench_tax_refund_archive_finance_owner",
  "tax_refund_archive_finance_owner",
  "workbench_default_finance_owner",
];
export const PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE = ["已完成", "已关闭"];
export const LOGISTICS_INVOICE_TO_UPLOAD_STATUSES = ["待开票", "未通知", "已通知开票", "通知失败", "待开票 / 通知失败", "部分未通知", "部分已通知", "部分待开票", "部分上传发票", "部分已上传", "部分上传", "部分已确认"];
export const LOGISTICS_INVOICE_UPLOADED_STATUSES = ["已上传发票", "已上传", "已确认", "已确认发票"];
export const LOGISTICS_INVOICE_DONE_STATUSES = ["已上传发票", "已上传", "已确认", "已确认发票"];
export const LOGISTICS_PAYMENT_READY_INVOICE_STATUSES = ["已上传发票", "已上传", "已确认", "已确认发票"];
export const LOGISTICS_PAYMENT_DONE_STATUSES = ["已付款"];
export const NEGATIVE_PROFIT_THRESHOLD = 0;
export const PROFIT_COST_REVIEW_STATUSES = ["生产中", "已发货", "部分收款", "已收齐", "多收款"];
export const PROFIT_COST_REQUIRED_STATUSES = ["已发货", "部分收款", "已收齐", "多收款"];

export function paymentVoucherReminderStartDateFromSettings(settings: unknown) {
  const input = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const text = normalizeDateText(input.paymentVoucherReminderStartDate, PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE);
  const dateText = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE;
  const date = new Date(`${dateText}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? new Date(`${PAYMENT_VOUCHER_REMINDER_DEFAULT_START_DATE}T00:00:00.000Z`)
    : date;
}

export type TodoCost = {
  id: string;
  order: TodoOrder;
  supplierId?: string | null;
  supplier?: { id?: string | null; supplierName?: string | null; supplierType?: string | null } | null;
  supplierNameSnapshot?: string | null;
  vendorName?: string | null;
  costType?: string | null;
  sourceType?: string | null;
  paymentStatus?: string | null;
  paid?: boolean | null;
  paidAt?: Date | string | null;
  paymentDate?: Date | string | null;
  paymentVoucherUrl?: string | null;
  paymentVoucherStorageKey?: string | null;
  paymentVoucherUploadedAt?: Date | string | null;
  documents?: Array<{ documentType?: string | null; uploadStatus?: string | null; relatedModule?: string | null; costId?: string | null; supplierId?: string | null; deletedAt?: Date | string | null }> | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type TodoPayment = {
  id: string;
  order: TodoOrder;
  paymentDate?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type TodoLogisticsBill = {
  id: string;
  order: TodoOrder;
  supplierId?: string | null;
  supplier?: TodoSupplier | null;
  billOfLadingNo?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  submittedAt?: Date | string | null;
  reviewedAt?: Date | string | null;
  paymentDate?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type ProfitOrder = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;
