import { prisma } from "../prisma";
import { canRead } from "./shared-access";
import { nonEmpty } from "./shared";
import {
  LOGISTICS_INVOICE_TO_UPLOAD_STATUSES,
  LOGISTICS_INVOICE_UPLOADED_STATUSES,
  LOGISTICS_PAYMENT_DONE_STATUSES,
  LOGISTICS_PAYMENT_READY_INVOICE_STATUSES,
  TODO_LIMIT_PER_SOURCE,
  isAdmin,
  isFinance,
  isFinanceOperator,
  isLogisticsOperator,
  isSalesperson,
  logisticsBillAccessWhere,
  logisticsOwnerForOrder,
  roleOwner,
  supplierOwner,
  todoForLogisticsBill,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";
import { logisticsBillReviewAccessWhere } from "./workbench-todos-workflow-helpers";

function logisticsBillWorkflowFinished(bill: { auditStatus?: string | null; invoiceStatus?: string | null; paymentStatus?: string | null }) {
  return bill.auditStatus === "审核通过" && LOGISTICS_INVOICE_UPLOADED_STATUSES.includes(nonEmpty(bill.invoiceStatus))
    && LOGISTICS_PAYMENT_DONE_STATUSES.includes(nonEmpty(bill.paymentStatus));
}

function logisticsBillNeedsInvoiceUpload(bill: { auditStatus?: string | null; invoiceStatus?: string | null; paymentStatus?: string | null }) {
  return bill.auditStatus === "审核通过" && LOGISTICS_INVOICE_TO_UPLOAD_STATUSES.includes(nonEmpty(bill.invoiceStatus))
    && !LOGISTICS_PAYMENT_DONE_STATUSES.includes(nonEmpty(bill.paymentStatus));
}

function logisticsBillNeedsPaymentRegistration(bill: { auditStatus?: string | null; invoiceStatus?: string | null; paymentStatus?: string | null }) {
  return bill.auditStatus === "审核通过" && LOGISTICS_PAYMENT_READY_INVOICE_STATUSES.includes(nonEmpty(bill.invoiceStatus))
    && !LOGISTICS_PAYMENT_DONE_STATUSES.includes(nonEmpty(bill.paymentStatus));
}

const billInclude = {
  order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" as const }] } } },
  supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
};

export async function listLogisticsFeeTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "domesticLogistics") && !canRead(actor, "costs")) return [];
  if (!(isAdmin(actor) || isSalesperson(actor) || isFinance(actor) || isLogisticsOperator(actor))) return [];
  const accessWhere = logisticsBillAccessWhere(actor);
  const [reviewBills, invoiceBills, paymentBills] = await Promise.all([
    isAdmin(actor) || isFinance(actor) || isSalesperson(actor) ? prisma.logisticsBill.findMany({
      where: { deletedAt: null, status: { not: "voided" }, AND: [{ auditStatus: "待审核" }, { paymentStatus: { notIn: LOGISTICS_PAYMENT_DONE_STATUSES } }, logisticsBillReviewAccessWhere(actor)] },
      include: billInclude, orderBy: [{ submittedAt: "asc" }, { updatedAt: "asc" }], take: TODO_LIMIT_PER_SOURCE,
    }) : Promise.resolve([]),
    prisma.logisticsBill.findMany({
      where: { deletedAt: null, status: { not: "voided" }, AND: [{ auditStatus: "审核通过" }, { invoiceStatus: { in: LOGISTICS_INVOICE_TO_UPLOAD_STATUSES } }, { paymentStatus: { notIn: LOGISTICS_PAYMENT_DONE_STATUSES } }, accessWhere] },
      include: billInclude, orderBy: [{ reviewedAt: "asc" }, { updatedAt: "asc" }], take: TODO_LIMIT_PER_SOURCE,
    }),
    isFinanceOperator(actor) ? prisma.logisticsBill.findMany({
      where: { deletedAt: null, status: { not: "voided" }, AND: [{ auditStatus: "审核通过" }, { invoiceStatus: { in: LOGISTICS_PAYMENT_READY_INVOICE_STATUSES } }, { paymentStatus: { notIn: LOGISTICS_PAYMENT_DONE_STATUSES } }, accessWhere] },
      include: billInclude, orderBy: [{ paymentDate: "asc" }, { updatedAt: "asc" }], take: TODO_LIMIT_PER_SOURCE,
    }) : Promise.resolve([]),
  ]);
  return [
    ...reviewBills.filter((bill) => !logisticsBillWorkflowFinished(bill)).map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_FEE_REVIEW", title: "物流费用待审核", bill, context,
      dueAt: bill.submittedAt || bill.updatedAt, owner: roleOwner(context, "FINANCE"),
    })),
    ...invoiceBills.filter(logisticsBillNeedsInvoiceUpload).map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_INVOICE_UPLOAD", title: "物流发票待上传", bill, context,
      dueAt: bill.reviewedAt || bill.updatedAt,
      owner: bill.supplier ? supplierOwner(context, bill.supplier, "LOGISTICS_SUPPLIER", "物流供应商") : logisticsOwnerForOrder(context, bill.order),
      ownerName: bill.supplier?.supplierName || "物流供应商",
    })),
    ...paymentBills.filter(logisticsBillNeedsPaymentRegistration).map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_PAYMENT_REGISTER", title: "物流付款待登记", bill, context,
      dueAt: bill.paymentDate || bill.updatedAt, owner: roleOwner(context, "FINANCE"), ownerName: "财务/管理员",
    })),
  ];
}
