import { prisma } from "../prisma";
import { nonEmpty, sanitizeForLog } from "./shared";
import { logisticsBillAccessWhere } from "./workbench-todos-core";
import { invalidateWorkbenchTodosCache, listWorkbenchTodos } from "./workbench-todos";
import type { ActorLike, WorkbenchTodo } from "./workbench-todos-types";
import {
  LOGISTICS_INVOICE_TO_UPLOAD_STATUSES,
  LOGISTICS_INVOICE_UPLOADED_STATUSES,
  LOGISTICS_PAYMENT_DONE_STATUSES,
  LOGISTICS_PAYMENT_READY_INVOICE_STATUSES,
} from "./workbench-todos-types";

const LOGISTICS_TODO_TYPES = new Set([
  "LOGISTICS_FEE_REVIEW",
  "LOGISTICS_INVOICE_UPLOAD",
  "LOGISTICS_PAYMENT_REGISTER",
]);

function workflowNode(row: { auditStatus?: string | null; invoiceStatus?: string | null; paymentStatus?: string | null }) {
  const auditStatus = nonEmpty(row.auditStatus);
  const invoiceStatus = nonEmpty(row.invoiceStatus);
  const paymentStatus = nonEmpty(row.paymentStatus);
  if (
    auditStatus === "审核通过"
    && LOGISTICS_INVOICE_UPLOADED_STATUSES.includes(invoiceStatus)
    && LOGISTICS_PAYMENT_DONE_STATUSES.includes(paymentStatus)
  ) return "FINISHED";
  if (auditStatus === "待审核") return "REVIEW_PENDING";
  if (auditStatus !== "审核通过") return "DRAFT_OR_REJECTED";
  if (LOGISTICS_INVOICE_TO_UPLOAD_STATUSES.includes(invoiceStatus)) return "INVOICE_TO_UPLOAD";
  if (LOGISTICS_PAYMENT_READY_INVOICE_STATUSES.includes(invoiceStatus) && !LOGISTICS_PAYMENT_DONE_STATUSES.includes(paymentStatus)) {
    return "PAYMENT_TO_REGISTER";
  }
  return "BLOCKED_OR_UNKNOWN";
}

function blockedReasons(row: { auditStatus?: string | null; invoiceStatus?: string | null; paymentStatus?: string | null }) {
  const auditStatus = nonEmpty(row.auditStatus);
  const invoiceStatus = nonEmpty(row.invoiceStatus);
  const paymentStatus = nonEmpty(row.paymentStatus);
  if (workflowNode(row) === "FINISHED") return ["流程已结束，物流费用待办全部关闭"];
  const reasons: string[] = [];
  if (auditStatus !== "待审核") reasons.push("物流费用待审核关闭：审核状态不是待审核");
  if (!(auditStatus === "审核通过" && LOGISTICS_INVOICE_TO_UPLOAD_STATUSES.includes(invoiceStatus))) {
    reasons.push("物流发票待上传关闭：未处于审核通过且待开票状态");
  }
  if (!(auditStatus === "审核通过" && LOGISTICS_PAYMENT_READY_INVOICE_STATUSES.includes(invoiceStatus) && !LOGISTICS_PAYMENT_DONE_STATUSES.includes(paymentStatus))) {
    reasons.push("物流付款待登记关闭：未处于已上传发票且未付款状态");
  }
  if (LOGISTICS_PAYMENT_DONE_STATUSES.includes(paymentStatus)) reasons.push("付款已完成");
  return reasons;
}

function activeLogisticsTodosForBill(todos: WorkbenchTodo[], orderId: string, billId: string) {
  return todos
    .filter((todo) => todo.orderId === orderId && todo.status === "ACTIVE" && LOGISTICS_TODO_TYPES.has(todo.type) && todo.id.endsWith(`-${billId}`))
    .map((todo) => ({
      id: todo.id,
      type: todo.type,
      title: todo.title,
      status: todo.status,
      ownerName: todo.ownerName || "",
      generatedReason: todo.activationCondition,
    }));
}

export async function listWorkbenchTodoDiagnostics(actor: ActorLike, orderNos: string[] = []) {
  const normalizedOrderNos = orderNos.map(nonEmpty).filter(Boolean);
  invalidateWorkbenchTodosCache();
  const todosResult = await listWorkbenchTodos(actor);
  const accessWhere = logisticsBillAccessWhere(actor);
  const bills = await prisma.logisticsBill.findMany({
    where: {
      deletedAt: null,
      status: { not: "voided" },
      AND: [
        accessWhere,
        ...(normalizedOrderNos.length ? [{ order: { is: { orderNo: { in: normalizedOrderNos } } } }] : []),
      ],
    },
    include: {
      order: { select: { id: true, orderNo: true } },
      supplier: { select: { supplierName: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: normalizedOrderNos.length ? Math.max(20, normalizedOrderNos.length * 5) : 80,
  });
  const diagnostics = bills.map((bill) => {
    const activeTodos = activeLogisticsTodosForBill(todosResult.todos, bill.orderId, bill.id);
    const node = workflowNode(bill);
    return {
      orderNo: bill.order.orderNo,
      billId: bill.id,
      billOfLadingNo: bill.billOfLadingNo || "",
      supplierName: bill.supplier?.supplierName || "",
      currentWorkflowNode: node,
      workflowStatus: node === "FINISHED" ? "FINISHED" : "ACTIVE_OR_BLOCKED",
      reviewStatus: bill.auditStatus,
      invoiceStatus: bill.invoiceStatus,
      paymentStatus: bill.paymentStatus,
      activeTodos,
      blockedTodos: blockedReasons(bill).map((reason) => ({ status: "BLOCKED", reason })),
      generatedReasons: activeTodos.map((todo) => todo.generatedReason),
      closedReasons: blockedReasons(bill),
      updatedAt: bill.updatedAt,
    };
  });
  console.info("workbench-todo-diagnostics", sanitizeForLog({
    userId: actor?.id || "",
    role: actor?.role || "",
    orderNos: normalizedOrderNos,
    scanned: bills.length,
    activeTodoCount: diagnostics.reduce((sum, item) => sum + item.activeTodos.length, 0),
  }));
  return {
    diagnostics,
    scanned: bills.length,
    activeTodoCount: diagnostics.reduce((sum, item) => sum + item.activeTodos.length, 0),
  };
}
