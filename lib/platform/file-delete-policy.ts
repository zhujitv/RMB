import type { OrderDocumentType } from "../generated/prisma/client.js";
import { canAccessOrder } from "./order-access";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  LOGISTICS_OPERATOR_ROLE,
  canWrite,
  codedError,
  effectivePermissions,
  normalizeOrderDocumentType,
  permissionError,
} from "./shared";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type DocumentOrderLike = {
  taxRefundStatus?: string | null;
} & Record<string, unknown>;
type DocumentCostLike = {
  createdById?: string | null;
};
type OrderDocumentLike = {
  documentType?: string | null;
  relatedModule?: string | null;
  order?: DocumentOrderLike | null;
  cost?: DocumentCostLike | null;
};

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

function isProtectedCustomsDocumentType(documentType: unknown = "") {
  return DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(normalizeOrderDocumentType(String(documentType || "")) as OrderDocumentType);
}

export function canDeleteOrderDocumentFile(actor: ActorLike, document: OrderDocumentLike) {
  if (!canWrite(actor, "documents")) return false;
  if (["SUBMITTED", "COMPLETED", "ARCHIVED"].includes(String(document.order?.taxRefundStatus || ""))) return false;
  if (actorRole(actor) === "业务员" && isProtectedCustomsDocumentType(document.documentType)) return false;
  if (actorRole(actor) === LOGISTICS_OPERATOR_ROLE && DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(document.documentType as OrderDocumentType)) return false;
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return document.relatedModule !== "SUPPLIER" && canAccessOrder(actor, document.order);
  if (scope === "OWN_COST") return document.relatedModule === "SUPPLIER" && document.cost?.createdById === actor?.id;
  return false;
}

export function assertCanDeleteOrderDocumentFile(actor: ActorLike, document: OrderDocumentLike, message = "无权限删除该订单单证") {
  if (!canDeleteOrderDocumentFile(actor, document)) throw permissionError(message);
}

export function assertCanDeleteLogisticsInvoiceFile({
  canManageInvoice,
  invoiceConfirmed,
}: {
  canManageInvoice: boolean;
  invoiceConfirmed: boolean;
}) {
  if (!canManageInvoice) throw permissionError("无权限删除该物流费用发票", 403);
  if (invoiceConfirmed) {
    throw codedError("已确认发票不能删除。", 400, "LOGISTICS_INVOICE_CONFIRMED_DELETE_BLOCKED");
  }
}
