import { prisma } from "../prisma";
import { type OrderDocumentType } from "../generated/prisma/client.js";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  FACTORY_SUPPLIER_COST_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  TAX_EXPORT_DOCUMENT_TYPES,
  assertRead,
  cachedTaxRefundCompleteness,
  codedError,
  customerFullName,
  customerShortName,
  dateToInput,
  domesticLogisticsInfoSafeSelect,
  includeOrderRelations,
  permissionError,
  refreshTaxRefundCompletenessForOrder,
  serializeOrder,
  taxRefundStatusFromCompleteness,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import { scheduleRepairTaxRelationsOnStartup } from "./repair-tax-relations";
import { serializeTaxRefundListOrderLight } from "./tax-refunds-list";
import {
  TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES,
  TAX_REFUND_SUPPLIER_DOCUMENT_LIMIT,
  type ActorLike,
  type TaxRefundCostLight,
  type TaxRefundDocumentLight,
  combineTaxRefundDomesticLogisticsInfos,
  hydrateTaxRefundOrderLogisticsInfo,
  serializeTaxRefundLightCost,
  serializeTaxRefundLightDocument,
  serializeTaxRefundOrderForActor,
  taxRefundCostLightSelect,
  taxRefundDocumentLightSelect,
  taxRefundLightListSelect,
  uniqueTaxRefundDocuments,
  withHistoricalSupplierDocuments,
} from "./tax-refunds-shared";

export async function getTaxRefundOrderDetail(orderId: string, actor: ActorLike) {
  assertRead(actor, "taxRefund");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const orderWithLogistics = await hydrateTaxRefundOrderLogisticsInfo(order);
  const completeness = await refreshTaxRefundCompletenessForOrder(orderWithLogistics);
  const status = taxRefundStatusFromCompleteness(order.taxRefundStatus, completeness);
  return serializeTaxRefundOrderForActor({
    ...orderWithLogistics,
    taxRefundCompleteness: completeness || order.taxRefundCompleteness,
    taxRefundCompletenessUpdatedAt: completeness ? new Date() : order.taxRefundCompletenessUpdatedAt,
    taxRefundStatus: status,
  }, actor);
}

async function getTaxRefundBaseOrder(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      ...taxRefundLightListSelect,
      customsDeclarationNo: true,
      customsDeclarationDate: true,
      taxRefundArchivedBy: { select: { id: true, name: true } },
      taxSubmittedBy: { select: { id: true, name: true } },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  return order;
}

function serializeTaxRefundBasicOrder(order: Awaited<ReturnType<typeof getTaxRefundBaseOrder>>) {
  const light = serializeTaxRefundListOrderLight(order);
  return {
    ...light,
    taxRefundArchivedByName: order.taxRefundArchivedBy?.name || "",
    taxSubmittedByName: order.taxSubmittedBy?.name || order.taxRefundArchivedBy?.name || "",
    customsDeclarationNo: order.customsDeclarationNo || "",
    customsDeclarationDate: dateToInput(order.customsDeclarationDate),
    documentCompleteness: cachedTaxRefundCompleteness(order),
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
  };
}

async function getTaxRefundBasicSection(orderId: string, actor: ActorLike) {
  return serializeTaxRefundBasicOrder(await getTaxRefundBaseOrder(orderId, actor));
}

async function getTaxRefundDocumentSection(orderId: string, actor: ActorLike, documentTypes: string[]) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      customerNameSnapshot: true,
      customer: { select: { name: true, shortName: true } },
      documents: {
        where: {
          deletedAt: null,
          documentType: { in: documentTypes as OrderDocumentType[] },
        },
        select: taxRefundDocumentLightSelect,
        orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
        take: 80,
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerName: customerShortName(order.customer) || customerFullName(order.customer, order.customerNameSnapshot),
    documents: (order.documents || []).map((document) => serializeTaxRefundLightDocument(document, order as Record<string, unknown>)),
  };
}

async function getTaxRefundCustomsDocumentsSection(orderId: string, actor: ActorLike) {
  const [basic, documents] = await Promise.all([
    getTaxRefundBasicSection(orderId, actor),
    getTaxRefundDocumentSection(orderId, actor, DOMESTIC_LOGISTICS_DOCUMENT_TYPES),
  ]);
  return {
    ...documents,
    ...basic,
    customsDeclarationNo: basic.customsDeclarationNo || "",
    customsDeclarationDate: basic.customsDeclarationDate || null,
    declarationDate: basic.declarationDate || null,
  };
}

async function getTaxRefundCostDocumentSection(orderId: string, actor: ActorLike, type: "factory" | "logistics") {
  const costTypes = type === "factory" ? FACTORY_SUPPLIER_COST_TYPES : TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES;
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      taxRefundCompleteness: true,
      taxRefundCompletenessUpdatedAt: true,
      costs: {
        where: { deletedAt: null, costType: { in: costTypes } },
        select: taxRefundCostLightSelect,
        orderBy: [{ createdAt: "desc" }],
        take: 80,
      },
      ...(type === "factory" ? {
        documents: {
          where: {
            deletedAt: null,
            documentType: { in: SUPPLIER_DOCUMENT_TYPES },
            OR: [
              { relatedModule: "SUPPLIER" },
              { factoryDocumentRequestId: { not: null } },
              { costId: { not: null } },
            ],
          },
          select: taxRefundDocumentLightSelect,
          orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
          take: TAX_REFUND_SUPPLIER_DOCUMENT_LIMIT,
        },
      } : {}),
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const orderCosts = (order.costs || []) as TaxRefundCostLight[];
  const historicalDocuments = (
    type === "factory" && "documents" in order && Array.isArray(order.documents)
      ? order.documents
      : []
  ) as unknown as TaxRefundDocumentLight[];
  const costRows = type === "factory"
    ? withHistoricalSupplierDocuments(orderCosts, historicalDocuments)
    : orderCosts;
  const costs = costRows.map((cost) => serializeTaxRefundLightCost(cost, order as Record<string, unknown>));
  const documents = uniqueTaxRefundDocuments(costs.flatMap((cost) => cost.documents || []));
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    documentCompleteness: cachedTaxRefundCompleteness(order),
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
    costs,
    documents,
  };
}

async function getTaxRefundLogisticsDocumentsSection(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      taxRefundCompleteness: true,
      taxRefundCompletenessUpdatedAt: true,
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        select: domesticLogisticsInfoSafeSelect(),
        orderBy: [{ updatedAt: "desc" }],
        take: 5,
      },
      costs: {
        where: { deletedAt: null, costType: { in: TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES } },
        select: taxRefundCostLightSelect,
        orderBy: [{ createdAt: "desc" }],
        take: 80,
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或无权查看", 404);
  const costs = (order.costs || []).map((cost) => serializeTaxRefundLightCost(cost, order as Record<string, unknown>));
  const documents = costs.flatMap((cost) => cost.documents || []);
  const domesticLogisticsInfo = combineTaxRefundDomesticLogisticsInfos(order.domesticLogisticsInfos || [])[0] || null;
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    documentCompleteness: cachedTaxRefundCompleteness(order),
    taxRefundCompletenessUpdatedAt: order.taxRefundCompletenessUpdatedAt || null,
    domesticLogisticsInfo: domesticLogisticsInfo ? serializeOrder({ id: order.id, domesticLogisticsInfos: [domesticLogisticsInfo] }).domesticLogisticsInfo : null,
    costs,
    documents,
  };
}

export type TaxRefundDetailSection =
  | "basic"
  | "export-documents"
  | "customs-documents"
  | "factory-documents"
  | "logistics-documents";

export async function getTaxRefundOrderDetailSection(orderId: string, actor: ActorLike, section: TaxRefundDetailSection) {
  assertRead(actor, "taxRefund");
  scheduleRepairTaxRelationsOnStartup();
  if (section === "basic") return getTaxRefundBasicSection(orderId, actor);
  if (section === "export-documents") return getTaxRefundDocumentSection(orderId, actor, TAX_EXPORT_DOCUMENT_TYPES);
  if (section === "customs-documents") return getTaxRefundCustomsDocumentsSection(orderId, actor);
  if (section === "factory-documents") return getTaxRefundCostDocumentSection(orderId, actor, "factory");
  if (section === "logistics-documents") return getTaxRefundLogisticsDocumentsSection(orderId, actor);
  throw codedError("未知退税资料详情分段", 400, "INVALID_TAX_REFUND_DETAIL_SECTION");
}
