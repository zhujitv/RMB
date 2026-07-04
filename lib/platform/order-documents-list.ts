import { prisma } from "../prisma";
import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { documentOrderListAccessWhere } from "./masters-access";
import {
  ORDER_DOCUMENT_TYPES,
  assertRead,
  effectivePermissions,
  normalizeOrderDocumentType,
  serializeOrderDocument,
} from "./shared";
import {
  assertDocumentOrder,
  type ActorLike,
  type QueryLike,
} from "./order-documents-types";

export async function listOrderDocuments(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "documents");
  const orderId = query.get("orderId") || "";
  const documentType = normalizeOrderDocumentType(query.get("documentType") || "");
  const relatedModule = query.get("relatedModule") || "";
  const costId = query.get("costId") || "";
  const supplierId = query.get("supplierId") || "";
  const scope = effectivePermissions(actor).dataScope;
  const accessWhere = documentOrderListAccessWhere(actor, documentType);
  const where: Prisma.OrderDocumentWhereInput = {
    deletedAt: null,
    ...(orderId ? { orderId } : {}),
    ...(ORDER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType) ? { documentType: documentType as OrderDocumentType } : {}),
    ...(relatedModule ? { relatedModule } : {}),
    ...(costId ? { costId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...accessWhere,
    ...(scope === "OWN_COST" ? { relatedModule: "SUPPLIER", cost: { is: { createdById: actor?.id || "__no_user__" } } } : {}),
  };
  if (orderId) await assertDocumentOrder(orderId, actor, documentType);
  const rows = await prisma.orderDocument.findMany({
    where,
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    take: orderId ? 200 : 1000,
  });
  const documentsByOrderId = rows.reduce<Record<string, typeof rows>>((acc, document) => {
    acc[document.orderId] ||= [];
    acc[document.orderId].push(document);
    return acc;
  }, {});
  return rows.map((document) => serializeOrderDocument(document, {
    ...(document.order || {}),
    documents: documentsByOrderId[document.orderId] || [],
  }));
}