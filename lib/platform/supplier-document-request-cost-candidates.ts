import { prisma } from "../prisma";
import { assertWrite, codedError, nonEmpty } from "./shared";
import {
  SUPPLIER_DOCUMENT_COST_CANDIDATE_LIMIT,
  SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT,
  activeSupplierDocumentRequestPairSet,
  serializeSupplierDocumentCostCandidate,
  supplierDocumentRequestOccupiedCostSet,
  supplierDocumentRequestFactoryCostInclude,
  supplierDocumentRequestFactoryCostWhere,
  supplierDocumentRequestPairKey,
  type ActorLike,
  type QueryLike,
} from "./supplier-document-request-types";

export async function listSupplierDocumentRequestCostCandidates(
  query: QueryLike,
  actor: ActorLike,
) {
  if (actor?.role !== "管理员") {
    throw codedError(
      "只有管理员可以发起资料回传通知。",
      403,
      "SUPPLIER_DOCUMENT_NOTICE_ADMIN_ONLY",
    );
  }
  assertWrite(actor, "supplierDocuments");
  const keyword = nonEmpty(query.get("q") || query.get("keyword"));
  const costs = await prisma.orderCost.findMany({
    where: supplierDocumentRequestFactoryCostWhere({ keyword }),
    include: supplierDocumentRequestFactoryCostInclude(),
    orderBy: [{ createdAt: "desc" }],
    take: SUPPLIER_DOCUMENT_COST_CANDIDATE_SCAN_LIMIT,
  });
  const [occupiedCostIds, legacyExistingPairs] = await Promise.all([
    supplierDocumentRequestOccupiedCostSet(costs),
    activeSupplierDocumentRequestPairSet(costs, { legacyWithoutCostOnly: true }),
  ]);
  return costs
    .filter((cost) => !occupiedCostIds.has(cost.id))
    .filter((cost) => !legacyExistingPairs.has(
      supplierDocumentRequestPairKey(cost.orderId, cost.supplierId || ""),
    ))
    .slice(0, SUPPLIER_DOCUMENT_COST_CANDIDATE_LIMIT)
    .map((cost) => serializeSupplierDocumentCostCandidate(cost));
}
