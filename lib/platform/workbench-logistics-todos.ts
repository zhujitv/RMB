import { prisma } from "../prisma";
import { canRead } from "./shared-access";
import {
  FACTORY_SUPPLIER_COST_TYPES,
  ORDER_COST_STATUS_VOID,
  nonEmpty,
} from "./shared";
import {
  TODO_LIMIT_PER_SOURCE,
  activeOrderBaseWhere,
  isAdmin,
  isLogisticsOperator,
  isLogisticsSupplier,
  isSalesperson,
  logisticsOwnerForOrder,
  orderHref,
  todoForOrder,
  type WorkbenchTodo,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";
import { requiresContainerNumber, requiresLogisticsFeeEntry } from "./workbench-todo-rules";
import {
  billOfLadingExists,
  customsDeclarationUploaded,
  domesticLogisticsInfoExists,
  doneSupplierDocumentRequests,
  logisticsSupplierAssigned,
  orderEnteredLogisticsStage,
  transportInfoExists,
  type WorkbenchWorkflowOrder,
} from "./workbench-todos-workflow-helpers";

export { listLogisticsFeeTodos } from "./workbench-logistics-fee-todos";

export async function listDomesticLogisticsTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "domesticLogistics") || !(isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) return [];
  const where = activeOrderBaseWhere(actor);
  const orders = await prisma.receivableOrder.findMany({
    where: {
      AND: [
        where,
        { status: { notIn: ["草稿", "待审核"] } },
        { logisticsSuppliers: { some: {} } },
      ],
    },
    include: {
      customer: true,
      salesperson: { select: { id: true, name: true, email: true, role: true } },
      logisticsSuppliers: {
        include: {
          supplier: {
            include: {
              operatorUsers: {
                where: { isActive: true, approvalStatus: "APPROVED" },
                select: { id: true, name: true, email: true, role: true, supplierId: true },
              },
            },
          },
        },
        orderBy: [{ assignedAt: "desc" }],
      },
      logisticsBills: {
        where: { deletedAt: null, status: { not: "voided" } },
        select: { id: true, billOfLadingNo: true },
      },
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
        orderBy: [{ updatedAt: "desc" }],
      },
      supplierDocumentRequests: {
        where: { deletedAt: null },
        select: { status: true, supplierId: true, costId: true, completedAt: true, deletedAt: true },
        take: 50,
      },
      costs: {
        where: { deletedAt: null, status: { not: ORDER_COST_STATUS_VOID }, costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
        select: {
          id: true,
          supplierId: true,
          sourceType: true,
          costType: true,
          status: true,
          deletedAt: true,
          documents: {
            where: { deletedAt: null, relatedModule: "SUPPLIER", documentType: { in: ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"] } },
            select: { documentType: true, uploadStatus: true, relatedModule: true, costId: true, supplierId: true, deletedAt: true },
            take: 10,
          },
        },
        take: 50,
      },
      documents: {
        where: {
          deletedAt: null,
          OR: [
            { relatedModule: "SUPPLIER", documentType: { in: ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"] } },
            { documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS", relatedModule: { not: "SUPPLIER" } },
          ],
        },
        select: { documentType: true, uploadStatus: true, relatedModule: true, costId: true, supplierId: true, deletedAt: true },
        take: 120,
      },
      logisticsExpenses: {
        where: { deletedAt: null, bill: { is: { status: { not: "voided" } } } },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: TODO_LIMIT_PER_SOURCE,
  });
  const todos: WorkbenchTodo[] = [];
  for (const order of orders) {
    const workflowOrder = order as WorkbenchWorkflowOrder;
    if (!logisticsSupplierAssigned(workflowOrder)) continue;
    if (!doneSupplierDocumentRequests(workflowOrder)) continue;
    if (!orderEnteredLogisticsStage(workflowOrder)) continue;
    const logisticsOwner = logisticsOwnerForOrder(context, order);
    const hasLogisticsInfo = domesticLogisticsInfoExists(workflowOrder);
    const hasBillNo = billOfLadingExists(workflowOrder);
    if (!hasLogisticsInfo) {
      todos.push(todoForOrder({
        type: "LOGISTICS_INFO_MISSING",
        title: "物流信息待录入",
        module: "物流信息",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.dueDate,
        href: orderHref("/domestic-logistics", order),
        owner: logisticsOwner,
      }));
      continue;
    }
    if (!hasBillNo) {
      todos.push(todoForOrder({
        type: "BILL_OF_LADING_MISSING",
        title: "提单号缺失",
        module: "物流信息",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/domestic-logistics", order),
        owner: logisticsOwner,
      }));
    }
    const hasContainerMissing = order.domesticLogisticsInfos.some((info) => requiresContainerNumber(info.transportType) && (
      !info.transportItems.length || info.transportItems.some((item) => !nonEmpty(item.containerNo))
    ));
    if (hasContainerMissing) {
      todos.push(todoForOrder({
        type: "CONTAINER_NO_MISSING",
        title: "柜号缺失",
        module: "物流信息",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/domestic-logistics", order),
        owner: logisticsOwner,
      }));
    }
    if (!customsDeclarationUploaded(workflowOrder)) {
      todos.push(todoForOrder({
        type: "TAX_CUSTOMS_DECLARATION_MISSING",
        title: "报关资料待上传",
        module: "物流信息",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/domestic-logistics", order),
        owner: logisticsOwner,
      }));
    }
    if (requiresLogisticsFeeEntry(order.tradeTerm) && !order.logisticsExpenses.length && transportInfoExists(workflowOrder) && (isAdmin(actor) || isSalesperson(actor) || isLogisticsSupplier(actor))) {
      todos.push(todoForOrder({
        type: "LOGISTICS_FEE_ENTRY",
        title: "物流费用待录入",
        module: "物流费用",
        order,
        context,
        dueAt: order.expectedShipmentDate || order.expectedArrivalDate,
        href: orderHref("/logistics-fees", order),
        owner: logisticsOwner,
      }));
    }
  }
  return todos;
}
