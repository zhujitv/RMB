import { prisma } from "../prisma";
import { canRead } from "./shared-access";
import { orderAccessWhere } from "./order-access";
import { isProductSupplierOperatorRole } from "./shared";
import { addDays, startOfChinaDay } from "./workbench-todo-rules";
import {
  LOGISTICS_INVOICE_DONE_STATUSES,
  TODO_LIMIT_PER_SOURCE,
  actorRole,
  actorSupplierId,
  isAdmin,
  isFinance,
  isFinanceOperator,
  isLogisticsOperator,
  isSalesperson,
  logisticsBillAccessWhere,
  logisticsOwnerForOrder,
  orderHref,
  paidCostWhere,
  productSupplierPaymentCostWhere,
  roleOwner,
  salespersonOwner,
  shipsgoTrackingAccessWhere,
  sortWorkbenchTodos,
  supplierOwner,
  taxRefundArchiveOwner,
  todoForCost,
  todoForLogisticsBill,
  todoForOrder,
  todoForPayment,
  uniqueTodos,
  type WorkbenchTodo,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";

export async function completedTodayTodos(context: WorkbenchTodoContext, now = new Date()) {
  const actor = context.actor;
  const today = startOfChinaDay(now);
  const tomorrow = addDays(today, 1);
  const batches: Promise<WorkbenchTodo[]>[] = [];
  const productCostWhere = productSupplierPaymentCostWhere();
  if (canRead(actor, "payments") && isFinanceOperator(actor)) {
    batches.push(prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: "已到账",
        updatedAt: { gte: today, lt: tomorrow },
        order: { is: orderAccessWhere(actor) },
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((payment) => todoForPayment({
      type: "CUSTOMER_PAYMENT_CONFIRMED",
      title: "客户回款已确认",
      payment,
      context,
      owner: roleOwner(context, "FINANCE"),
      status: "completed",
    }))));
  }
  if (canRead(actor, "costs") && isFinanceOperator(actor)) {
    batches.push(prisma.orderCost.findMany({
      where: {
        deletedAt: null,
        paymentStatus: { not: "已取消" },
        AND: [
          productCostWhere,
          {
            OR: [
              { paidAt: { gte: today, lt: tomorrow } },
              { paymentVoucherUploadedAt: { gte: today, lt: tomorrow } },
              { updatedAt: { gte: today, lt: tomorrow }, ...paidCostWhere() },
            ],
          },
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
        supplier: { select: { id: true, supplierName: true, supplierType: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((cost) => todoForCost({
      type: "FACTORY_PAYMENT_COMPLETED",
      title: "工厂付款已登记",
      module: "成本管理",
      cost,
      context,
      dueAt: cost.paidAt || cost.paymentDate || cost.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      status: "completed",
    }))));
  }
  if (canRead(actor, "supplierDocuments") && (isAdmin(actor) || isProductSupplierOperatorRole(actorRole(actor)))) {
    batches.push(prisma.supplierDocumentRequest.findMany({
      where: {
        deletedAt: null,
        status: "已完成",
        updatedAt: { gte: today, lt: tomorrow },
        ...(isProductSupplierOperatorRole(actorRole(actor))
          ? { supplierId: actorSupplierId(actor) || "__no_supplier_bound__" }
          : {}),
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
        supplier: {
          include: {
            operatorUsers: {
              where: { isActive: true, approvalStatus: "APPROVED" },
              select: { id: true, name: true, email: true, role: true, supplierId: true },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((row) => todoForOrder({
      id: `supplier-document-return-completed-${row.id}`,
      type: "SUPPLIER_DOCUMENT_RETURN_COMPLETED",
      title: "供应商资料已回传",
      module: "资料回传",
      order: row.order,
      context,
      dueAt: row.dueDate || row.updatedAt,
      href: orderHref("/supplier-documents", row.order, {
        requestId: row.id,
        keyword: row.order.orderNo,
      }),
      owner: supplierOwner(context, row.supplier, "PRODUCT_SUPPLIER", "产品供应商"),
      status: "completed",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))));
  }
  if ((canRead(actor, "domesticLogistics") || canRead(actor, "costs")) && (isAdmin(actor) || isSalesperson(actor) || isFinance(actor) || isLogisticsOperator(actor))) {
    const accessWhere = logisticsBillAccessWhere(actor);
    batches.push(prisma.logisticsBill.findMany({
      where: {
        deletedAt: null,
        AND: [
          accessWhere,
          {
            OR: [
              { auditStatus: "审核通过", reviewedAt: { gte: today, lt: tomorrow } },
              { invoiceStatus: { in: LOGISTICS_INVOICE_DONE_STATUSES }, updatedAt: { gte: today, lt: tomorrow } },
            ],
          },
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
        supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((bill) => {
      const invoiceDone = LOGISTICS_INVOICE_DONE_STATUSES.includes(bill.invoiceStatus || "");
      const owner = invoiceDone
        ? (bill.supplier ? supplierOwner(context, bill.supplier, "LOGISTICS_SUPPLIER", "物流供应商") : logisticsOwnerForOrder(context, bill.order))
        : roleOwner(context, "FINANCE");
      return todoForLogisticsBill({
        type: invoiceDone ? "LOGISTICS_INVOICE_UPLOAD_COMPLETED" : "LOGISTICS_FEE_REVIEW_COMPLETED",
        title: invoiceDone ? "物流发票已上传" : "物流费用已审核",
        bill,
        context,
        dueAt: invoiceDone ? bill.updatedAt : (bill.reviewedAt || bill.updatedAt),
        owner,
        ownerName: owner.ownerName || (invoiceDone ? "物流供应商" : "财务/管理员"),
        status: "completed",
      });
    })));
  }
  if (canRead(actor, "domesticLogistics") && isFinanceOperator(actor)) {
    batches.push(prisma.logisticsBill.findMany({
      where: {
        deletedAt: null,
        AND: [
          logisticsBillAccessWhere(actor),
          { auditStatus: "审核通过" },
          { paymentStatus: "已付款" },
          { updatedAt: { gte: today, lt: tomorrow } },
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } }, logisticsSuppliers: { include: { supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } } }, orderBy: [{ assignedAt: "desc" }] } } },
        supplier: { include: { operatorUsers: { where: { isActive: true, approvalStatus: "APPROVED" }, select: { id: true, name: true, email: true, role: true, supplierId: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((bill) => todoForLogisticsBill({
      type: "LOGISTICS_PAYMENT_REGISTER_COMPLETED",
      title: "物流付款已登记",
      bill,
      context,
      dueAt: bill.paymentDate || bill.updatedAt,
      owner: roleOwner(context, "FINANCE"),
      ownerName: "财务/管理员",
      status: "completed",
    }))));
  }
  if (canRead(actor, "taxRefund") && (isAdmin(actor) || isSalesperson(actor) || isFinance(actor))) {
    batches.push(prisma.customsDeclaration.findMany({
      where: {
        deletedAt: null,
        taxArchived: true,
        taxRefundArchivedAt: { gte: today, lt: tomorrow },
        order: { is: { deletedAt: null, ...orderAccessWhere(actor) } },
      },
      include: { order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } } },
      orderBy: [{ taxRefundArchivedAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((row) => {
      const order = {
        ...row.order,
        id: row.id,
        orderId: row.orderId,
        customsDeclarationId: row.id,
        orderNo: row.order.orderNo,
        blNo: row.billOfLadingNo || row.order.blNo,
        billOfLadingNo: row.billOfLadingNo || row.order.blNo,
        customsDeclarationNo: row.declarationNo || "",
        customsDeclarationDate: row.declarationDate || null,
        taxRefundStatus: row.taxRefundStatus,
        taxArchived: row.taxArchived,
        taxSubmittedAt: row.taxSubmittedAt,
        taxRefundArchivedAt: row.taxRefundArchivedAt,
        updatedAt: row.updatedAt || row.order.updatedAt,
        createdAt: row.createdAt || row.order.createdAt,
      };
      return todoForOrder({
        type: "TAX_REFUND_ARCHIVED",
        title: "退税资料已归档",
        module: "退税资料",
        order,
        context,
        dueAt: row.taxRefundArchivedAt || row.updatedAt,
        href: orderHref("/tax-refund", order, {
          keyword: row.id,
        }),
        owner: taxRefundArchiveOwner(context, order),
        status: "completed",
        updatedAt: row.updatedAt,
      });
    })));
  }
  if (canRead(actor, "commissions") && isFinanceOperator(actor)) {
    batches.push(prisma.receivableOrder.findMany({
      where: {
        deletedAt: null,
        commissionStatus: { in: ["已结算", "SETTLED"] },
        commissionSettledAt: { gte: today, lt: tomorrow },
        AND: [orderAccessWhere(actor)],
      },
      include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: [{ commissionSettledAt: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((order) => todoForOrder({
      type: "COMMISSION_SETTLED",
      title: "提成已结算",
      module: "利润分析",
      order,
      context,
      dueAt: order.commissionSettledAt || order.updatedAt,
      href: orderHref("/profit", order),
      owner: roleOwner(context, "FINANCE"),
      status: "completed",
      updatedAt: order.updatedAt,
    }))));
  }
  if (canRead(actor, "domesticLogistics") && (isAdmin(actor) || isSalesperson(actor) || isLogisticsOperator(actor))) {
    batches.push(prisma.shipsgoTracking.findMany({
      where: {
        AND: [
          shipsgoTrackingAccessWhere(actor),
          {
            deletedAt: null,
            provider: "SHIPSGO",
            mode: "OCEAN",
            lastSyncTime: { gte: today, lt: tomorrow },
          },
        ],
      },
      include: {
        order: { include: { customer: true, salesperson: { select: { id: true, name: true, email: true, role: true } } } },
      },
      orderBy: [{ lastSyncTime: "desc" }],
      take: TODO_LIMIT_PER_SOURCE,
    }).then((rows) => rows.map((row) => todoForOrder({
      id: `container-tracking-synced-${row.id}`,
      type: "CONTAINER_TRACKING_SYNCED",
      title: "集装箱跟踪已同步",
      module: "运输监控",
      order: row.order,
      context,
      dueAt: row.lastSyncTime || row.lastSyncedAt || row.updatedAt,
      href: orderHref("/ocean-control-tower", row.order, {
        trackingId: row.id,
        keyword: row.order.orderNo,
      }),
      owner: salespersonOwner(row.order),
      status: "completed",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))));
  }
  const values = await Promise.all(batches);
  return uniqueTodos(values.flat()).sort(sortWorkbenchTodos);
}
