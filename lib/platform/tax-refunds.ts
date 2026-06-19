// @ts-nocheck
import JSZip from "jszip";
import { prisma } from "../prisma";
import { readR2Object, safeFileName } from "../r2";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  ARCHIVE_TAX_REFUND_STATUSES,
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  ORDER_DOCUMENT_LABELS,
  ORDER_DOCUMENT_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_REFUND_STATUS_LABELS,
  TAX_REFUND_STATUSES,
  assertRead,
  canWrite,
  cachedTaxRefundCompleteness,
  codedError,
  customerFullName,
  customerShortName,
  getExchangeRateSettings,
  getCommissionFormulaSettings,
  includeOrderRelations,
  needsTaxRefundCompletenessRefresh,
  nonEmpty,
  num,
  optional,
  permissionError,
  refreshTaxRefundCompleteness,
  roundMoney,
  serializeOrder,
  serializeCustomsRecognition,
  standardFilenameForDocument,
  summarizeOrder,
  taxDocumentCompleteness,
  taxRefundStatusFromCompleteness,
  writeAudit,
} from "./shared";
import { canReadDocumentContent } from "./order-documents";
import { orderAccessWhere } from "./order-access";

export function serializeTaxRefundListOrder(order) {
  const completeness = cachedTaxRefundCompleteness(order);
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  const arrivedPaymentsCny = (order.payments || [])
    .filter((payment) => payment.status === "已到账" && !payment.deletedAt)
    .reduce((sum, payment) => sum + Number(payment.amountCny || 0), 0);
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    currency: order.currency,
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    receivedAmountCny: arrivedPaymentsCny,
    taxRefundStatus: status,
    taxRefundStatusLabel: TAX_REFUND_STATUS_LABELS[status] || status,
    taxArchived: Boolean(order.taxArchived || status === "SUBMITTED" || order.taxRefundArchivedAt),
    taxRefundArchivedByName: order.taxRefundArchivedBy?.name || "",
    taxRefundArchivedAt: order.taxRefundArchivedAt || null,
    taxRefundArchiveRemark: order.taxRefundArchiveRemark || "",
    taxSubmittedByName: order.taxSubmittedBy?.name || order.taxRefundArchivedBy?.name || "",
    taxSubmittedAt: order.taxSubmittedAt || order.taxRefundArchivedAt || null,
    ...serializeCustomsRecognition(order),
    documentCompleteness: completeness,
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
  };
}

function taxRefundCompletenessPercent(order = {}) {
  const completeness = cachedTaxRefundCompleteness(order);
  const total = Number(completeness.total || 0);
  if (total <= 0) return 0;
  return Math.round((Number(completeness.completed || 0) / total) * 100);
}

function taxRefundStatusSortRank(status = "") {
  return {
    NOT_READY: 1,
    PROBLEM: 2,
    READY: 3,
    SUBMITTED: 4,
  }[status] || 5;
}

function dateSortValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortTaxRefundOrders(a = {}, b = {}) {
  const percentDiff = taxRefundCompletenessPercent(a) - taxRefundCompletenessPercent(b);
  if (percentDiff) return percentDiff;
  const aStatus = taxRefundStatusFromCompleteness(a.taxRefundStatus, cachedTaxRefundCompleteness(a));
  const bStatus = taxRefundStatusFromCompleteness(b.taxRefundStatus, cachedTaxRefundCompleteness(b));
  const statusDiff = taxRefundStatusSortRank(aStatus) - taxRefundStatusSortRank(bStatus);
  if (statusDiff) return statusDiff;
  const updatedDiff = dateSortValue(b.updatedAt) - dateSortValue(a.updatedAt);
  if (updatedDiff) return updatedDiff;
  return dateSortValue(b.createdAt) - dateSortValue(a.createdAt);
}

export async function listTaxRefundOrders(query, actor) {
  assertRead(actor, "taxRefund");
  const page = Math.max(1, Math.round(num(query.get("page"), 1)));
  const pageSize = Math.min(100, Math.max(1, Math.round(num(query.get("pageSize"), 20))));
  const keyword = nonEmpty(query.get("q") || query.get("keyword") || query.get("search"));
  const mode = nonEmpty(query.get("mode")) === "archive" ? "archive" : "current";
  const statusFilter = nonEmpty(query.get("status"));
  const declarationStartMonth = nonEmpty(query.get("declarationStartMonth"));
  const declarationEndMonth = nonEmpty(query.get("declarationEndMonth"));
  const declarationStart = declarationStartMonth && /^\d{4}-\d{2}$/.test(declarationStartMonth) ? new Date(`${declarationStartMonth}-01T00:00:00.000Z`) : null;
  const declarationEnd = declarationEndMonth && /^\d{4}-\d{2}$/.test(declarationEndMonth) ? new Date(`${declarationEndMonth}-01T00:00:00.000Z`) : null;
  const declarationMonthEnd = declarationEnd ? new Date(Date.UTC(declarationEnd.getUTCFullYear(), declarationEnd.getUTCMonth() + 1, 1)) : null;
  const declarationMonthStart = declarationStart || null;
  const statusMatches = keyword
    ? Object.entries(TAX_REFUND_STATUS_LABELS)
      .filter(([status, label]) => status.toLowerCase().includes(keyword.toLowerCase()) || label.toLowerCase().includes(keyword.toLowerCase()))
      .map(([status]) => status)
    : [];
  const keywordWhere = keyword ? {
    OR: [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { blNo: { contains: keyword, mode: "insensitive" } },
      { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
      { country: { contains: keyword, mode: "insensitive" } },
      { currency: { contains: keyword, mode: "insensitive" } },
      { taxRefundStatus: { contains: keyword, mode: "insensitive" } },
      { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
      { customer: { is: { country: { contains: keyword, mode: "insensitive" } } } },
      { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { costs: { some: {
        deletedAt: null,
        OR: [
          { supplierNameSnapshot: { contains: keyword, mode: "insensitive" } },
          { vendorName: { contains: keyword, mode: "insensitive" } },
          { supplier: { is: { supplierName: { contains: keyword, mode: "insensitive" } } } },
        ],
      } } },
      ...(statusMatches.length ? [{ taxRefundStatus: { in: statusMatches } }] : []),
    ],
  } : {};
  const where = {
    deletedAt: null,
    AND: [
      orderAccessWhere(actor),
      keywordWhere,
      ...(mode === "archive"
        ? [{ OR: [{ taxArchived: true }, { taxRefundStatus: { in: ARCHIVE_TAX_REFUND_STATUSES } }] }]
        : [{ taxArchived: false }, { taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES } }]),
      ...(TAX_REFUND_STATUSES.includes(statusFilter) ? [{ taxRefundStatus: statusFilter }] : []),
      ...(declarationMonthStart || declarationMonthEnd ? [{
        customsDeclarationDate: {
          ...(declarationMonthStart ? { gte: declarationMonthStart } : {}),
          ...(declarationMonthEnd ? { lt: declarationMonthEnd } : {}),
        },
      }] : []),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    prisma.receivableOrder.findMany({
      where,
      include: {
        customer: true,
        taxRefundArchivedBy: true,
        taxSubmittedBy: true,
        payments: {
          where: { deletedAt: null, status: "已到账" },
          select: { amountCny: true, status: true, deletedAt: true },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const refreshedEntries = await Promise.all(
    rows
      .filter(needsTaxRefundCompletenessRefresh)
      .map(async (order) => [order.id, await refreshTaxRefundCompleteness(order.id)]),
  );
  const refreshedById = Object.fromEntries(refreshedEntries.filter(([, completeness]) => completeness));
  const hydratedRows = rows
    .map((order) => (refreshedById[order.id]
      ? { ...order, taxRefundCompleteness: refreshedById[order.id], taxRefundCompletenessUpdatedAt: new Date() }
      : order))
    .sort(sortTaxRefundOrders);
  const pagedRows = hydratedRows.slice((page - 1) * pageSize, page * pageSize);
  return {
    orders: pagedRows.map(serializeTaxRefundListOrder),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    query: keyword,
    mode,
  };
}

export async function getTaxRefundOrderDetail(orderId, actor) {
  assertRead(actor, "taxRefund");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  await refreshTaxRefundCompleteness(order.id);
  const refreshed = await prisma.receivableOrder.findUnique({
    where: { id: order.id },
    include: includeOrderRelations(),
  });
  return serializeOrder(refreshed || order);
}

export async function updateTaxRefundStatus(request, actor, orderId, status, input = {}) {
  if (!canWrite(actor, "taxRefund")) throw permissionError("没有权限修改退税状态", 403);
  if (!TAX_REFUND_STATUSES.includes(status)) throw permissionError("请选择有效退税状态", 400);
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const beforeArchived = Boolean(before.taxArchived || before.taxRefundStatus === "SUBMITTED" || before.taxRefundArchivedAt);
  if (beforeArchived && status !== "SUBMITTED" && input.cancelArchive !== true) {
    throw permissionError("已提交退税档案只允许查看和下载资料。", 400);
  }
  const completeness = taxDocumentCompleteness(before);
  if (status === "SUBMITTED" && before.taxRefundStatus === "SUBMITTED" && beforeArchived) {
    throw codedError("该订单已提交退税并归档，不能重复提交。", 400, "TAX_REFUND_ALREADY_SUBMITTED");
  }
  const settings = await getExchangeRateSettings();
  const forceSubmit = status === "SUBMITTED"
    && actor?.role === "管理员"
    && settings.allowAdminIncompleteTaxSubmit === true
    && input.forceSubmit === true;
  if (["READY", "SUBMITTED"].includes(status) && !completeness.complete && !forceSubmit) {
    const error = codedError("资料尚未完整，无法提交退税。", 400, "TAX_REFUND_COMPLETENESS_REQUIRED");
    error.details = {
      completed: Number(completeness.completed || 0),
      total: Number(completeness.total || 0),
      percent: Number(completeness.total || 0) > 0
        ? Math.round((Number(completeness.completed || 0) / Number(completeness.total || 0)) * 100)
        : 0,
      missingLabels: completeness.missingLabels || [],
      text: completeness.text || "",
    };
    throw error;
  }
  if (forceSubmit && !optional(input.forceReason)) {
    throw codedError("强制提交退税必须填写原因。", 400, "FORCE_SUBMIT_REASON_REQUIRED");
  }
  const archiveRemark = optional(input.archiveRemark || input.remark);
  const now = new Date();
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: {
      taxRefundStatus: status,
      updatedById: actor.id,
      ...(status === "SUBMITTED" ? {
        taxArchived: true,
        taxRefundArchivedById: actor.id,
        taxRefundArchivedAt: now,
        taxRefundArchiveRemark: forceSubmit ? optional(input.forceReason) : archiveRemark,
        taxSubmittedById: actor.id,
        taxSubmittedAt: now,
      } : {}),
    },
    include: includeOrderRelations(),
  });
  await writeAudit(
    request,
    actor,
    status === "SUBMITTED" ? "提交退税并归档" : "修改退税状态",
    "receivable_orders",
    order.id,
    {
      orderNo: before.orderNo,
      taxRefundStatus: before.taxRefundStatus,
      taxArchived: beforeArchived,
    },
    {
      orderNo: order.orderNo,
      taxRefundStatus: order.taxRefundStatus,
      taxArchived: Boolean(order.taxArchived),
      forceSubmit,
      forceReason: forceSubmit ? optional(input.forceReason) : undefined,
    },
  ).catch(() => null);
  return serializeOrder(order);
}

export async function cancelTaxRefundArchive(request, actor, orderId, nextStatus = "NOT_READY", input = {}) {
  if (actor?.role !== "管理员") throw permissionError("只有管理员可以取消归档。", 403);
  const restoredStatus = TAX_REFUND_STATUSES.includes(nextStatus) && nextStatus !== "SUBMITTED" ? nextStatus : "NOT_READY";
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw permissionError("应收订单不存在或已删除", 404);
  const completeness = taxDocumentCompleteness(before);
  const finalStatus = restoredStatus === "READY" && !completeness.complete ? "NOT_READY" : restoredStatus;
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: {
      taxArchived: false,
      taxRefundArchivedById: null,
      taxRefundArchivedAt: null,
      taxRefundArchiveRemark: optional(input.remark),
      taxSubmittedById: null,
      taxSubmittedAt: null,
      taxRefundStatus: finalStatus,
      updatedById: actor.id,
    },
    include: includeOrderRelations(),
  });
  await writeAudit(
    request,
    actor,
    "取消归档",
    "receivable_orders",
    order.id,
    {
      orderNo: before.orderNo,
      taxRefundStatus: before.taxRefundStatus,
      taxArchived: Boolean(before.taxArchived || before.taxRefundArchivedAt),
    },
    {
      orderNo: order.orderNo,
      taxRefundStatus: order.taxRefundStatus,
      taxArchived: false,
      remark: optional(input.remark),
    },
  ).catch(() => null);
  return serializeOrder(order);
}

export async function settleCommission(request, actor, orderId, input = {}) {
  if (!canWrite(actor, "commissions")) {
    throw codedError("没有权限结算业务员提成。", 403, "PERMISSION_DENIED");
  }
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!before) throw codedError("应收订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
  if (["已结算", "SETTLED"].includes(before.commissionStatus)) {
    throw codedError("该订单业务员提成已结算，不能重复结算。", 400, "COMMISSION_ALREADY_SETTLED");
  }
  const commissionFormulaSettings = await getCommissionFormulaSettings();
  const summary = summarizeOrder(before, commissionFormulaSettings);
  if (summary.commissionRate <= 0) {
    throw codedError("提成比例未设置，不能结算业务员提成。", 400, "COMMISSION_RATE_NOT_SET");
  }
  if (!summary.realSalespersonSet) {
    throw codedError("未分配真实业务员，不能结算业务员提成。", 400, "SALESPERSON_NOT_SET");
  }
  if (summary.arrivedOutstandingCny > 0 || !["已收齐", "多收款"].includes(before.status)) {
    throw codedError("当前订单货款尚未全部到账，不能结算业务员提成。", 400, "ORDER_NOT_FULLY_PAID");
  }
  if (!summary.taxLogisticsCostsComplete) {
    const missingText = (summary.taxLogisticsMissingLabels || []).join("、") || "物流费用";
    throw codedError(`退税资料中的物流费用未完整，缺少：${missingText}。不能结算业务员提成。`, 400, "TAX_LOGISTICS_COSTS_INCOMPLETE");
  }
  if (!summary.allCostsConfirmed) {
    throw codedError("当前订单成本尚未全部确认完成，不能结算业务员提成。", 400, "COST_NOT_CONFIRMED");
  }
  if (!summary.logisticsCostConfirmed) {
    throw codedError("当前订单物流成本尚未确认完成，不能结算业务员提成。", 400, "LOGISTICS_COST_NOT_CONFIRMED");
  }
  const paidAmountCny = roundMoney(summary.arrivedPaymentsCny);
  const logisticsCostCny = roundMoney(summary.confirmedLogisticsCostCny);
  const commissionBaseCny = roundMoney(summary.settleableCommissionBaseCny);
  const commissionAmountCny = roundMoney((commissionBaseCny * summary.commissionRate) / 100);
  if (commissionAmountCny <= 0) {
    throw codedError("提成金额为 0，不能结算，请检查提成比例和成本数据。", 400, "COMMISSION_AMOUNT_ZERO");
  }
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      await tx.commissionSettlement.create({
        data: {
          orderId,
          salespersonUserId: before.salespersonUserId,
          commissionRate: summary.commissionRate,
          paidAmountCny,
          logisticsCostCny,
          commissionBaseCny,
          commissionAmountCny,
          settledById: actor.id,
          remark: optional(input.remark),
        },
      });
      return tx.receivableOrder.update({
        where: { id: orderId },
        data: {
          commissionStatus: "SETTLED",
          commissionSettledById: actor.id,
          commissionSettledAt: new Date(),
          commissionSettlementRemark: optional(input.remark),
          updatedById: actor.id,
        },
        include: includeOrderRelations(),
      });
    });
  } catch {
    throw codedError("数据库写入失败，业务员提成未结算。", 500, "DATABASE_ERROR");
  }
  await writeAudit(request, actor, "结算业务员提成", "receivable_orders", order.id, before, order).catch(() => null);
  return serializeOrder(order);
}

function taxPackageName(order) {
  return `退税资料_${safeFileName(order.orderNo || "订单")}_${safeFileName(order.blNo || "待发货")}_${safeFileName(order.customerNameSnapshot || order.customer?.name || "客户")}.zip`;
}

function supplierArchiveFileName(document, _index, _total, order = {}) {
  const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
  const isLogisticsInvoice = isTaxRefundLogisticsInvoiceDocument(document);
  const folder = isLogisticsInvoice ? "物流资料" : "供应商资料";
  return `${folder}/${safeFileName(supplierName)}/${standardFilenameForDocument(document, order)}`;
}

function isTaxRefundLogisticsInvoiceDocument(document) {
  return document?.relatedModule === "SUPPLIER" && document?.documentType && /_INVOICE$/.test(document.documentType);
}

function isTaxRefundSupplierDocument(document) {
  return document?.relatedModule === "SUPPLIER";
}

export async function buildTaxRefundPackage(request, actor, orderId, documentType = "") {
  assertRead(actor, "taxRefund");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: {
      customer: true,
      documents: {
        where: { deletedAt: null, uploadStatus: "SUCCESS" },
        include: { uploadedBy: true, cost: { include: { supplier: true } }, supplier: true },
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或已删除", 404);
  const selectedTypes = ORDER_DOCUMENT_TYPES.includes(documentType) ? [documentType] : ORDER_DOCUMENT_TYPES;
  const documents = order.documents
    .filter((document) => (
      selectedTypes.includes(document.documentType)
      && (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType) || isTaxRefundSupplierDocument(document))
      && canReadDocumentContent(actor, { ...document, order })
    ))
    .sort((a, b) => ORDER_DOCUMENT_TYPES.indexOf(a.documentType) - ORDER_DOCUMENT_TYPES.indexOf(b.documentType) || a.createdAt - b.createdAt);
  if (!documents.length) throw permissionError("没有可下载的 PDF 单证", 404);
  const zip = new JSZip();
  for (const type of selectedTypes) {
    const typeDocs = documents.filter((document) => document.documentType === type);
    if (SUPPLIER_DOCUMENT_TYPES.includes(type)) {
      const groups = Object.values(typeDocs.reduce((acc, document) => {
        const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
        acc[supplierName] ||= [];
        acc[supplierName].push(document);
        return acc;
      }, {}));
      for (const group of groups) {
        for (let index = 0; index < group.length; index += 1) {
          const document = group[index];
          zip.file(supplierArchiveFileName(document, index, group.length, order), await readR2Object(document.storageKey));
        }
      }
    } else {
      const folder = DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(type) ? "报关资料" : "出口资料";
      for (let index = 0; index < typeDocs.length; index += 1) {
        const document = typeDocs[index];
        zip.file(`${folder}/${standardFilenameForDocument(document, order)}`, await readR2Object(document.storageKey));
      }
    }
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await writeAudit(request, actor, documentType ? "下载单证分类ZIP" : "下载ZIP", "receivable_orders", order.id, null, {
    orderNo: order.orderNo,
    documentType: documentType || "ALL",
    fileCount: documents.length,
  }).catch(() => null);
  return { buffer, fileName: taxPackageName(order) };
}
