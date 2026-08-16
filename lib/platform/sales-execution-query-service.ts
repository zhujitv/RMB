import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertRead, codedError, pageParams, pageResult } from "./shared";
import {
  type SalesExecutionActor,
  type SalesExecutionClient,
  salesExecutionAccessWhere,
} from "./sales-execution-access";
import { serializeSalesExecution } from "./sales-execution-values";
import { FILE_ASSET_ROLES, FILE_ASSET_SOURCE_TABLES } from "./file-asset-data";
import { PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT } from "./factory-purchase-order-production-progress-values";
import { internalContainerLoadSelect } from "./sales-execution-container-loads";

type QueryLike = { get(key: string): string | null };

const userSelect = { id: true, name: true } satisfies Prisma.UserSelect;
const customerSelect = {
  id: true,
  name: true,
  shortName: true,
  country: true,
  defaultCurrency: true,
  salespersonUserId: true,
  commissionRate: true,
  commissionStatus: true,
} satisfies Prisma.CustomerSelect;
const entitySelect = { id: true, name: true, shortName: true } satisfies Prisma.BusinessEntitySelect;
const supplierSelect = { id: true, supplierName: true } satisfies Prisma.SupplierSelect;

export const salesExecutionDetailInclude = {
  customer: { select: customerSelect },
  businessEntity: { select: entitySelect },
  salesperson: { select: userSelect },
  dispatchedBy: { select: userSelect },
  shippingStartedBy: { select: userSelect },
  receivableOrder: { select: { id: true, orderNo: true, status: true, deletedAt: true, createdAt: true } },
  sourceQuotation: { select: { id: true, quoteNo: true, invoiceNo: true } },
  items: { orderBy: [{ lineNumber: "asc" as const }] },
  purchaseOrders: {
    orderBy: [{ sequenceNo: "asc" as const }],
    include: {
      supplier: { select: supplierSelect },
      dispatchedBy: { select: userSelect },
      respondedBy: { select: userSelect },
      productionStartedBy: { select: userSelect },
      productionCompletedBy: { select: userSelect },
      actualDeliveryRecordedBy: { select: userSelect },
      items: {
        orderBy: [{ lineNumber: "asc" as const }],
        include: { supplierPrice: true },
      },
      supplierResponses: {
        orderBy: [{ responseSequence: "asc" as const }],
        include: {
          respondedBy: { select: userSelect },
          internalDecidedBy: { select: userSelect },
          supplierPrices: {
            orderBy: [{ purchaseOrderItemId: "asc" as const }],
            select: {
              purchaseOrderItemId: true,
              unitPrice: true,
              amount: true,
            },
          },
        },
      },
      productionProgressReports: {
        orderBy: [{ sequenceNo: "desc" as const }],
        take: PRODUCTION_PROGRESS_REPORT_QUERY_LIMIT,
        include: {
          reportedBy: { select: userSelect },
          items: { orderBy: [{ purchaseOrderItemId: "asc" as const }] },
        },
      },
      deliveryQuantityVariances: {
        orderBy: [{ sequenceNo: "desc" as const }],
        take: 100,
        include: {
          requestedBy: { select: userSelect },
          decidedBy: { select: userSelect },
          items: { orderBy: [{ purchaseOrderItemId: "asc" as const }] },
        },
      },
      loadingResults: {
        orderBy: [{ sequenceNo: "desc" as const }],
        take: 100,
        include: {
          requestedBy: { select: userSelect },
          decidedBy: { select: userSelect },
          items: { orderBy: [{ purchaseOrderItemId: "asc" as const }] },
        },
      },
      payments: { orderBy: [{ sequenceNo: "asc" as const }] },
      adjustments: { orderBy: [{ sequenceNo: "asc" as const }] },
      settlement: {
        include: {
          createdBy: { select: userSelect },
          settledBy: { select: userSelect },
        },
      },
    },
  },
  containerLoads: {
    orderBy: [{ sequenceNo: "asc" as const }],
    select: internalContainerLoadSelect,
  },
  versions: {
    orderBy: [{ versionNumber: "desc" as const }],
    select: { id: true, versionNumber: true, createdAt: true },
  },
} satisfies Prisma.SalesExecutionInclude;

const listInclude = {
  customer: { select: customerSelect },
  businessEntity: { select: entitySelect },
  salesperson: { select: userSelect },
  receivableOrder: { select: { id: true, orderNo: true, status: true, deletedAt: true, createdAt: true } },
  sourceQuotation: { select: { id: true, quoteNo: true, invoiceNo: true } },
} satisfies Prisma.SalesExecutionInclude;

function sourceFilter(value: unknown) {
  const source = String(value || "").trim().toUpperCase();
  if (!source) return null;
  if (!(source === "DIRECT" || source === "QUOTATION")) {
    throw codedError("销售执行单来源筛选值无效", 400, "SALES_EXECUTION_SOURCE_INVALID");
  }
  return source as "DIRECT" | "QUOTATION";
}

function statusFilter(value: unknown) {
  const status = String(value || "").trim().toUpperCase();
  if (!status) return null;
  if (!(status === "DRAFT" || status === "DISPATCHED" || status === "VOIDED")) {
    throw codedError("销售执行单状态筛选值无效", 400, "SALES_EXECUTION_STATUS_INVALID");
  }
  return status as "DRAFT" | "DISPATCHED" | "VOIDED";
}

export async function loadSalesExecution(
  id: string,
  actor: SalesExecutionActor,
  client: SalesExecutionClient = prisma,
) {
  const execution = await client.salesExecution.findFirst({
    where: { id, ...salesExecutionAccessWhere(actor) },
    include: salesExecutionDetailInclude,
  });
  if (!execution) {
    throw codedError("销售执行单不存在或无权访问", 404, "SALES_EXECUTION_NOT_FOUND");
  }
  return execution;
}

export async function getSalesExecution(id: string, actor: SalesExecutionActor) {
  assertRead(actor, "salesExecution");
  const execution = await loadSalesExecution(id, actor);
  const responseIds = execution.purchaseOrders.flatMap((order) => order.supplierResponses.map((response) => response.id));
  const purchaseOrderIds = execution.purchaseOrders.map((order) => order.id);
  const evidenceAssets = responseIds.length || purchaseOrderIds.length
    ? await prisma.fileAsset.findMany({
      where: {
        isDeleted: false,
        deletedAt: null,
        OR: [
          ...(responseIds.length ? [{
            sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDER_SUPPLIER_RESPONSES,
            sourceId: { in: responseIds },
            fileRole: FILE_ASSET_ROLES.SUPPLIER_CONFIRMATION_EVIDENCE,
          }] : []),
          ...(purchaseOrderIds.length ? [{
            sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
            sourceId: { in: purchaseOrderIds },
            fileRole: FILE_ASSET_ROLES.PRODUCTION_COMPLETION_EVIDENCE,
          }] : []),
        ],
      },
    })
    : [];
  const uploaderIds = [...new Set(evidenceAssets.map((asset) => asset.uploadedById).filter((id): id is string => Boolean(id)))];
  const uploaders = uploaderIds.length
    ? await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: userSelect })
    : [];
  const uploaderById = new Map(uploaders.map((user) => [user.id, user]));
  const assetBySource = new Map(evidenceAssets.map((asset) => [
    `${asset.sourceTable}:${asset.sourceId}:${asset.fileRole}`,
    { ...asset, uploadedBy: asset.uploadedById ? uploaderById.get(asset.uploadedById) || null : null },
  ]));
  const withEvidence = {
    ...execution,
    purchaseOrders: execution.purchaseOrders.map((order) => ({
      ...order,
      productionCompletionEvidenceFile: assetBySource.get(
        `${FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS}:${order.id}:${FILE_ASSET_ROLES.PRODUCTION_COMPLETION_EVIDENCE}`,
      ) || null,
      supplierResponses: order.supplierResponses.map((response) => ({
        ...response,
        confirmationEvidenceFile: assetBySource.get(
          `${FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDER_SUPPLIER_RESPONSES}:${response.id}:${FILE_ASSET_ROLES.SUPPLIER_CONFIRMATION_EVIDENCE}`,
        ) || null,
      })),
    })),
  };
  return serializeSalesExecution(withEvidence, true);
}

export async function listSalesExecutions(query: QueryLike, actor: SalesExecutionActor) {
  assertRead(actor, "salesExecution");
  const { page, pageSize } = pageParams(query, 20, 100);
  const keyword = String(query.get("keyword") || query.get("q") || "").trim();
  const customerId = String(query.get("customerId") || "").trim();
  const sourceType = sourceFilter(query.get("sourceType"));
  const status = statusFilter(query.get("status"));
  const where: Prisma.SalesExecutionWhereInput = {
    ...salesExecutionAccessWhere(actor),
    ...(customerId ? { customerId } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(status ? { status } : {}),
    ...(keyword ? {
      OR: [
        { executionNo: { contains: keyword, mode: "insensitive" } },
        { customerOrderNo: { contains: keyword, mode: "insensitive" } },
        { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
        { customerShortNameSnapshot: { contains: keyword, mode: "insensitive" } },
        { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { sourceQuotation: { is: { quoteNo: { contains: keyword, mode: "insensitive" } } } },
        { items: { some: { productNameSnapshot: { contains: keyword, mode: "insensitive" } } } },
      ],
    } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.salesExecution.count({ where }),
    prisma.salesExecution.findMany({
      where,
      include: listInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return pageResult(rows.map((row) => serializeSalesExecution(row)), total, page, pageSize);
}
