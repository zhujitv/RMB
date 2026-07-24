import { prisma } from "../prisma";
import { canAccessOrder, orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  nonEmpty,
  needsTaxRefundCompletenessRefresh,
  cachedTaxRefundCompleteness,
  refreshTaxRefundCompletenessBatchWithSnapshots,
  taxRefundStatusFromCompleteness,
} from "./shared";
import {
  TODO_LIMIT_PER_SOURCE,
  isAdmin,
  isFinance,
  isSalesperson,
  orderHref,
  ownerFromUsers,
  roleOwner,
  taxRefundArchiveOwner,
  todoForOrder,
  type TodoOrder,
  type WorkbenchTodo,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";
import { forEachTaxRefundTodoPage, isOnlyExportInvoiceMissing } from "./workbench-tax-refund-todo-policy";
import {
  customsDeclarationUploaded,
  type WorkbenchWorkflowOrder,
} from "./workbench-todos-workflow-helpers";

export { listProfitTodos } from "./workbench-profit-todos";

function missingTaxRefundTodos(context: WorkbenchTodoContext, order: TodoOrder, missingLabels: string[] = []) {
  const owner = roleOwner(context, "FINANCE");
  const rules = [
    { type: "TAX_TRUCKING_INVOICE_MISSING", title: "拖车发票缺失", pattern: /拖车|物流费资料|物流费发票/ },
    { type: "TAX_PURCHASE_CONTRACT_MISSING", title: "采购合同缺失", pattern: /采购合同|工厂合同/ },
    { type: "TAX_VAT_INVOICE_MISSING", title: "增值税发票缺失", pattern: /增值税发票|工厂发票/ },
  ];
  return rules
    .filter((rule) => missingLabels.some((label) => rule.pattern.test(label)))
    .map((rule) => todoForOrder({
      type: rule.type,
      title: rule.title,
      module: "退税资料",
      order,
      context,
      href: orderHref("/tax-refund", order),
      owner,
      updatedAt: order.updatedAt,
    }));
}

function normalizedMissingLabels(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => nonEmpty(item)).filter(Boolean)
    : [];
}

export async function listTaxRefundTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "taxRefund") || !(isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) return [];
  const todos: WorkbenchTodo[] = [];
  const owner = roleOwner(context, "FINANCE");
  await forEachTaxRefundTodoPage(
    (cursorId, pageSize) => prisma.receivableOrder.findMany({
      where: {
        deletedAt: null,
        taxArchived: false,
        taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES },
        documents: {
          some: {
            deletedAt: null,
            documentType: "CUSTOMS_ENTRY_FORM",
            uploadStatus: "SUCCESS",
            relatedModule: { not: "SUPPLIER" },
          },
        },
        AND: [orderAccessWhere(actor)],
      },
      include: {
        customer: true,
        salesperson: { select: { id: true, name: true, email: true, role: true } },
        documents: {
          where: { deletedAt: null, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS" },
          select: { documentType: true, uploadStatus: true, relatedModule: true, deletedAt: true },
          take: 5,
        },
      },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    }),
    async (rows) => {
      const refreshRequiredOrderIds = rows.filter(needsTaxRefundCompletenessRefresh).map((order) => order.id);
      const refreshRequiredOrderIdSet = new Set(refreshRequiredOrderIds);
      const refreshedById = await refreshTaxRefundCompletenessBatchWithSnapshots(refreshRequiredOrderIds);
      for (const order of rows) {
        const workflowOrder = order as WorkbenchWorkflowOrder;
        if (!customsDeclarationUploaded(workflowOrder)) continue;
        const refreshed = refreshedById.get(order.id);
        if (refreshRequiredOrderIdSet.has(order.id) && !refreshed) continue;
        const completeness = refreshed?.completeness || cachedTaxRefundCompleteness(order);
        const total = Number(completeness.total || 0);
        const completed = Number(completeness.completed || 0);
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const orderWithCompleteness = refreshed
          ? {
              ...order,
              taxRefundCompleteness: completeness,
              taxRefundCompletenessUpdatedAt: refreshed.completenessUpdatedAt,
            }
          : order;
        const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
        if (total > 0 && completed < total) {
          if (isOnlyExportInvoiceMissing(completeness)) {
            const exportInvoiceOwner = ownerFromUsers(
              context.taxRefundExportInvoiceFinanceUsers.filter((user) => canAccessOrder(user, orderWithCompleteness)),
              "财务",
              "FINANCE",
            );
            todos.push(todoForOrder({
              type: "TAX_EXPORT_INVOICE_MISSING",
              title: "出口发票待上传",
              module: "退税资料",
              order: orderWithCompleteness,
              context,
              dueAt: orderWithCompleteness.taxRefundCompletenessUpdatedAt || orderWithCompleteness.updatedAt,
              href: orderHref("/tax-refund", orderWithCompleteness),
              owner: exportInvoiceOwner,
              updatedAt: orderWithCompleteness.updatedAt,
              visibility: "OWNER_ONLY",
            }));
            continue;
          }
          todos.push(todoForOrder({
            type: "TAX_REFUND_INCOMPLETE",
            title: `退税资料完整度不足 100%（${percent}%）`,
            module: "退税资料",
            order: orderWithCompleteness,
            context,
            href: orderHref("/tax-refund", orderWithCompleteness),
            owner,
            updatedAt: orderWithCompleteness.updatedAt,
          }));
          todos.push(...missingTaxRefundTodos(context, orderWithCompleteness, normalizedMissingLabels(completeness.missingLabels)));
        } else if (total > 0 && status !== "SUBMITTED" && !order.taxSubmittedAt && !order.taxRefundArchivedAt) {
          todos.push(todoForOrder({
            type: "TAX_REFUND_READY_NOT_ARCHIVED",
            title: "已满足退税条件但未归档",
            module: "退税资料",
            order: orderWithCompleteness,
            context,
            dueAt: orderWithCompleteness.taxRefundCompletenessUpdatedAt || orderWithCompleteness.updatedAt,
            href: orderHref("/tax-refund", orderWithCompleteness, {
              status: "READY",
              action: "submitTaxArchive",
            }),
            owner: taxRefundArchiveOwner(context, orderWithCompleteness),
            updatedAt: orderWithCompleteness.updatedAt,
          }));
        }
      }
    },
    TODO_LIMIT_PER_SOURCE,
  );
  return todos;
}
