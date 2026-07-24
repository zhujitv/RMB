import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  SUPPLIER_DOCUMENT_REQUEST_TERMINAL_STATUSES,
  supplierDocumentRequestRankingPagePlan,
} from "./supplier-document-request-ranking";
import {
  assertRead,
  dateToInput,
  isProductSupplierOperatorRole,
  nonEmpty,
  pageParams,
  pageResult,
} from "./shared";
import {
  SUPPLIER_DOCUMENT_REQUEST_STATUSES,
  supplierDocumentRequestListSelect,
  type ActorLike,
  type QueryLike,
  type SupplierDocumentRequestListRow,
} from "./supplier-document-request-types";
import {
  normalizeSupplierReturnDocumentType,
  requiredDocumentTypes,
} from "./supplier-document-request-serialization";

function supplierDocumentRequestListWhere(
  query: QueryLike,
  actor: ActorLike,
): Prisma.SupplierDocumentRequestWhereInput {
  const status = nonEmpty(query.get("status"));
  const keyword = nonEmpty(query.get("keyword") || query.get("q"));
  return {
    deletedAt: null,
    ...(SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(status) ? { status } : {}),
    ...(isProductSupplierOperatorRole(actor?.role)
      ? {
          supplierId: actor?.supplierId || "__no_supplier_bound__",
          supplier: { allowFactoryDocumentUpload: true, status: "启用", deletedAt: null },
        }
      : {}),
    ...(keyword && !isProductSupplierOperatorRole(actor?.role)
      ? {
          OR: [
            { purchaseOrderNo: { contains: keyword, mode: "insensitive" } },
            { supplier: { supplierName: { contains: keyword, mode: "insensitive" } } },
          ],
        }
      : keyword
        ? { purchaseOrderNo: { contains: keyword, mode: "insensitive" } }
        : {}),
  };
}

function serializeSupplierDocumentRequestListItem(
  row: SupplierDocumentRequestListRow,
  actor: ActorLike,
  uploadedCount: number,
) {
  const requiredTypes = requiredDocumentTypes(row.requiredDocumentTypes);
  return {
    id: row.id,
    purchaseOrderNo: row.purchaseOrderNo || "",
    supplierName: isProductSupplierOperatorRole(actor?.role)
      ? ""
      : (row.supplier?.supplierName || ""),
    status: SUPPLIER_DOCUMENT_REQUEST_STATUSES.includes(row.status) ? row.status : "待上传",
    dueDate: dateToInput(row.dueDate),
    requiredDocumentTypes: requiredTypes,
    uploadedCount,
    requiredCount: requiredTypes.length,
    updatedAt: row.updatedAt,
  };
}

type SupplierDocumentRequestListReadClient = Pick<
  Prisma.TransactionClient,
  "supplierDocumentRequest" | "orderDocument"
>;

async function supplierDocumentRequestUploadedCounts(
  rows: SupplierDocumentRequestListRow[],
  db: SupplierDocumentRequestListReadClient = prisma,
) {
  const requestIds = rows.map((row) => row.id).filter(Boolean);
  if (!requestIds.length) return new Map<string, number>();
  const requiredTypesByRequestId = new Map(rows.map((row) => [
    row.id,
    new Set(requiredDocumentTypes(row.requiredDocumentTypes).map((type) => (
      normalizeSupplierReturnDocumentType(type)
    ))),
  ]));
  const uploadedGroups = await db.orderDocument.groupBy({
    by: ["factoryDocumentRequestId", "documentType"],
    where: {
      factoryDocumentRequestId: { in: requestIds },
      deletedAt: null,
      uploadStatus: "SUCCESS",
    },
  });
  const uploadedTypesByRequestId = new Map<string, Set<string>>();
  for (const group of uploadedGroups) {
    const requestId = group.factoryDocumentRequestId || "";
    if (!requestId) continue;
    const documentType = normalizeSupplierReturnDocumentType(group.documentType);
    const requiredTypes = requiredTypesByRequestId.get(requestId);
    if (!requiredTypes?.has(documentType)) continue;
    const uploadedTypes = uploadedTypesByRequestId.get(requestId) || new Set<string>();
    uploadedTypes.add(documentType);
    uploadedTypesByRequestId.set(requestId, uploadedTypes);
  }
  return new Map([...uploadedTypesByRequestId.entries()].map(([requestId, uploadedTypes]) => (
    [requestId, uploadedTypes.size]
  )));
}

function supplierDocumentRequestRankingBucketWhere(
  where: Prisma.SupplierDocumentRequestWhereInput,
  actionable: boolean,
): Prisma.SupplierDocumentRequestWhereInput {
  const terminalStatuses = [...SUPPLIER_DOCUMENT_REQUEST_TERMINAL_STATUSES];
  return {
    AND: [
      where,
      actionable
        ? { status: { notIn: terminalStatuses } }
        : { status: { in: terminalStatuses } },
    ],
  };
}

async function loadSupplierDocumentRequestPageSegment(
  db: SupplierDocumentRequestListReadClient,
  where: Prisma.SupplierDocumentRequestWhereInput,
  skip: number,
  take: number,
): Promise<SupplierDocumentRequestListRow[]> {
  if (take <= 0) return [];
  return db.supplierDocumentRequest.findMany({
    where,
    select: supplierDocumentRequestListSelect(),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take,
  });
}

export async function listSupplierDocumentRequests(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const { page, pageSize } = pageParams(query, 10, 50);
  const where = supplierDocumentRequestListWhere(query, actor);
  const actionableWhere = supplierDocumentRequestRankingBucketWhere(where, true);
  const terminalWhere = supplierDocumentRequestRankingBucketWhere(where, false);
  return prisma.$transaction(async (tx) => {
    const total = await tx.supplierDocumentRequest.count({ where });
    const actionableCount = await tx.supplierDocumentRequest.count({ where: actionableWhere });
    const pagePlan = supplierDocumentRequestRankingPagePlan(page, pageSize, actionableCount);
    const actionableRows = await loadSupplierDocumentRequestPageSegment(
      tx,
      actionableWhere,
      pagePlan.actionable.skip,
      pagePlan.actionable.take,
    );
    const terminalRows = await loadSupplierDocumentRequestPageSegment(
      tx,
      terminalWhere,
      pagePlan.terminal.skip,
      pagePlan.terminal.take,
    );
    const rows = [...actionableRows, ...terminalRows];
    const uploadedCounts = await supplierDocumentRequestUploadedCounts(rows, tx);
    return pageResult(
      rows.map((row) => serializeSupplierDocumentRequestListItem(
        row,
        actor,
        uploadedCounts.get(row.id) || 0,
      )),
      total,
      page,
      pageSize,
    );
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 30_000,
  });
}

export async function getSupplierDocumentRequestStats(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "supplierDocuments");
  const where = supplierDocumentRequestListWhere(query, actor);
  const actionableWhere = supplierDocumentRequestRankingBucketWhere(where, true);
  return prisma.$transaction(async (tx) => {
    const totalCount = await tx.supplierDocumentRequest.count({ where });
    const pendingCount = await tx.supplierDocumentRequest.count({ where: actionableWhere });
    return { totalCount, pendingCount };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: 10_000,
    timeout: 15_000,
  });
}
