import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  FACTORY_SUPPLIER_COST_TYPES,
  getCommissionFormulaSettings,
  includeOrderRelations,
  isProductSupplierOperatorRole,
  listShipsgoControlTowerTrackings,
  nonEmpty,
  needsTaxRefundCompletenessRefresh,
  cachedTaxRefundCompleteness,
  refreshTaxRefundCompletenessBatch,
  summarizeOrder,
  taxRefundStatusFromCompleteness,
  validCost,
} from "./shared";
import {
  LOGISTICS_INVOICE_DONE_STATUSES,
  LOGISTICS_INVOICE_REVIEW_STATUSES,
  LOGISTICS_PAYMENT_DONE_STATUSES,
  LOGISTICS_PAYMENT_READY_INVOICE_STATUSES,
  NEGATIVE_PROFIT_THRESHOLD,
  PROFIT_COST_REQUIRED_STATUSES,
  PROFIT_COST_REVIEW_STATUSES,
  PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE,
  TODO_LIMIT_PER_SOURCE,
  activeOrderBaseWhere,
  actorRole,
  actorSupplierId,
  isAdmin,
  isFinance,
  isFinanceOperator,
  isLogisticsOperator,
  isLogisticsSupplier,
  isPurchase,
  isSalesperson,
  logisticsBillAccessWhere,
  logisticsOwnerForOrder,
  orderHref,
  paidCostWhere,
  productSupplierPaymentCostWhere,
  roleOwner,
  salespersonOwner,
  supplierOwner,
  taxRefundArchiveOwner,
  todoForCost,
  todoForLogisticsBill,
  todoForOrder,
  todoForPayment,
  isProductSupplierPaymentCost,
  type ProfitOrder,
  type TodoCost,
  type TodoOrder,
  type WorkbenchTodo,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";
import {
  billOfLadingExists,
  customsDeclarationUploaded,
  domesticLogisticsInfoExists,
  doneSupplierDocumentRequests,
  logisticsBillReviewAccessWhere,
  logisticsSupplierAssigned,
  orderEnteredLogisticsStage,
  transportInfoExists,
  type WorkbenchWorkflowOrder,
} from "./workbench-todos-workflow-helpers";

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
        where: { deletedAt: null },
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
        where: { deletedAt: null, costType: { in: FACTORY_SUPPLIER_COST_TYPES } },
        select: {
          id: true,
          supplierId: true,
          sourceType: true,
          costType: true,
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
        where: { deletedAt: null },
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
    const hasContainerMissing = order.domesticLogisticsInfos.some((info) => (
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
    if (!order.logisticsExpenses.length && transportInfoExists(workflowOrder) && (isAdmin(actor) || isSalesperson(actor) || isLogisticsSupplier(actor))) {
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

export async function listLogisticsFeeTodos(context: WorkbenchTodoContext) {
  const actor = context.actor;
  if (!canRead(actor, "domesticLogistics") && !canRead(actor, "costs")) return [];
  if (!(isAdmin(actor) || isSalesperson(actor) || isFinance(actor) || isLogisticsOperator(actor))) return [];
  const accessWhere = logisticsBillAccessWhere(actor);
  const reviewAccessWhere = logisticsBillReviewAccessWhere(actor);
  const [reviewBills, invoiceBills, invoiceReviewBills, paymentBills] = await Promise.all([
    isAdmin(actor) || isFinance(actor) || isSalesperson(actor)
      ? prisma.logisticsBill.findMany({
          where: {
            deletedAt: null,
            AND: [
              { auditStatus: "待审核" },
              reviewAccessWhere,
            ],
          },
          include: {
            order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
            supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
          },
          orderBy: [{ submittedAt: "asc" }, { updatedAt: "asc" }],
          take: TODO_LIMIT_PER_SOURCE,
        })
      : Promise.resolve([]),
    prisma.logisticsBill.findMany({
      where: {
        deletedAt: null,
        AND: [
          { auditStatus: "审核通过" },
          { invoiceStatus: { notIn: LOGISTICS_INVOICE_DONE_STATUSES } },
          {
            OR: [
              { invoiceNotifiedAt: { not: null } },
              { expenses: { some: { deletedAt: null, invoiceNotifiedAt: { not: null } } } },
            ],
          },
          accessWhere,
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
        supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
      },
      orderBy: [{ reviewedAt: "asc" }, { updatedAt: "asc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }),
    isFinanceOperator(actor)
      ? prisma.logisticsBill.findMany({
          where: {
            deletedAt: null,
            AND: [
              { auditStatus: "审核通过" },
              { invoiceStatus: { in: LOGISTICS_INVOICE_REVIEW_STATUSES } },
              { expenses: { some: { deletedAt: null, invoiceStatus: "已上传" } } },
              accessWhere,
            ],
          },
          include: {
            order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
            supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
          },
          orderBy: [{ updatedAt: "asc" }],
          take: TODO_LIMIT_PER_SOURCE,
        })
      : Promise.resolve([]),
    isFinanceOperator(actor)
      ? prisma.logisticsBill.findMany({
          where: {
            deletedAt: null,
            AND: [
              { auditStatus: "审核通过" },
              { invoiceStatus: { in: LOGISTICS_PAYMENT_READY_INVOICE_STATUSES } },
              { paymentStatus: { notIn: LOGISTICS_PAYMENT_DONE_STATUSES } },
              accessWhere,
            ],
          },
          include: {
            order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
            supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
          },
          orderBy: [{ paymentDate: "asc" }, { updatedAt: "asc" }],
          take: TODO_LIMIT_PER_SOURCE,
        })
      : Promise.resolve([]),
  ]);
  return [
    ...reviewBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_FEE_REVIEW",
      title: "物流费用待审核",
      bill,
      context,
      dueAt: bill.submittedAt || bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
    })),
    ...invoiceBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_INVOICE_UPLOAD",
      title: "物流发票待上传",
      bill,
      context,
      dueAt: bill.reviewedAt || bill.updatedAt,
      owner: bill.supplier ? supplierOwner(context, bill.supplier, "LOGISTICS_SUPPLIER", "物流供应商") : logisticsOwnerForOrder(context, bill.order),
      ownerName: bill.supplier?.supplierName || "物流供应商",
    })),
    ...invoiceReviewBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_INVOICE_REVIEW",
      title: "发票待审核",
      bill,
      context,
      dueAt: bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      ownerName: "财务/管理员",
    })),
    ...paymentBills.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_PAYMENT_REGISTER",
      title: "物流付款待登记",
      bill,
      context,
      dueAt: bill.paymentDate || bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      ownerName: "财务/管理员",
    })),
  ];
}
