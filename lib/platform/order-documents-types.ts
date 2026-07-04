import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  canAccessDomesticLogisticsOrder,
  canUseDomesticLogisticsDocumentScope,
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";
import { canAccessOrder } from "./order-access";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  LOGISTICS_OPERATOR_ROLE,
  SALES_DOCUMENT_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  assertRead,
  canRead,
  effectivePermissions,
  isProductSupplierOperatorRole,
  normalizeOrderDocumentType,
  permissionError,
  requireText,
  SALESPERSON_TAX_REFUND_UPLOAD_DOCUMENT_TYPES,
} from "./shared";
import type { writeAudit } from "./shared";

export type OrderDocumentUploadParams = {
  orderId: string;
  documentType: string;
  file: unknown;
  costId?: string;
  supplierId?: string;
  uploadSource?: string;
};

export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type QueryLike = Pick<URLSearchParams, "get">;
export type DocumentOrderCostLike = {
  id?: string | null;
  createdById?: string | null;
  deletedAt?: unknown;
} & Record<string, unknown>;
export type DocumentOrderDocumentLike = {
  relatedModule?: string | null;
  costId?: string | null;
  cost?: { createdById?: string | null } | null;
} & Record<string, unknown>;
export type DocumentOrderLike = {
  id?: string | null;
  orderNo?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  taxRefundStatus?: string | null;
  customer?: { salespersonUserId?: string | null } | null;
  logisticsSuppliers?: Array<{ supplierId?: string | null } | null> | null;
  domesticLogisticsInfos?: unknown[] | null;
  costs?: DocumentOrderCostLike[] | null;
  documents?: DocumentOrderDocumentLike[] | null;
} & Record<string, unknown>;
export type DocumentCostLike = {
  id?: string | null;
  createdById?: string | null;
  supplierId?: string | null;
  costType?: string | null;
  sourceType?: string | null;
  supplier?: Record<string, unknown> | null;
};
export type DocumentLike = {
  id?: string | null;
  orderId?: string | null;
  documentType?: string | null;
  relatedModule?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  factoryDocumentRequestId?: string | null;
  order?: DocumentOrderLike | null;
  cost?: DocumentCostLike | null;
  supplier?: Record<string, unknown> | null;
  uploadedBy?: Record<string, unknown> | null;
  uploadStatus?: string | null;
  storageKey?: string | null;
  mimeType?: string | null;
  standardFilename?: string | null;
  fileName?: string | null;
  originalName?: string | null;
  originalFilename?: string | null;
};
type ResolvedDocumentScopeInput = {
  orderId: string;
  documentType: string;
  costId?: string;
  supplierId?: string;
  uploadSource?: string;
};

export function actorId(actor: ActorLike) {
  return requireText(actor?.id, "当前用户");
}

function actorRole(actor: ActorLike) {
  return String(actor?.role || "");
}

export async function assertDocumentOrder(orderId: string, actor: ActorLike, documentType = "") {
  assertRead(actor, "documents");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      customer: true,
      createdBy: true,
      salesperson: true,
      logisticsSuppliers: { select: { supplierId: true } },
      costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } },
    },
  });
  if (!order) throw permissionError("请选择有效应收订单", 400);
  if (!canAccessOrder(actor, order) && !(canUseDomesticLogisticsDocumentScope(actor, documentType) && canAccessDomesticLogisticsOrder(actor, order))) {
    throw permissionError("无权限访问该订单单证");
  }
  return order;
}

function relatedModuleForDocumentType(documentType: string) {
  if (SUPPLIER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) return "SUPPLIER";
  if (SALES_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) return "SALES";
  return "EXPORT";
}

function canReadSupplierReturnDocument(actor: ActorLike, document: DocumentLike) {
  if (
    document.relatedModule !== "SUPPLIER"
    || !document.factoryDocumentRequestId
    || !document.supplierId
  ) {
    return false;
  }
  if (
    isProductSupplierOperatorRole(actorRole(actor))
    && document.supplierId === actor?.supplierId
    && canRead(actor, "supplierDocuments")
  ) {
    return true;
  }
  if (["管理员", "财务", "采购"].includes(actorRole(actor)) && (canRead(actor, "documents") || canRead(actor, "supplierDocuments"))) {
    return true;
  }
  if (actorRole(actor) === "业务员" && canRead(actor, "documents") && canAccessOrder(actor, document.order)) {
    return true;
  }
  return false;
}

function canReadDocument(actor: ActorLike, document: DocumentLike) {
  if (canReadSupplierReturnDocument(actor, document)) return true;
  if (!canRead(actor, "documents")) return false;
  if (canUseDomesticLogisticsDocumentScope(actor, String(document.documentType || "")) && canAccessDomesticLogisticsOrder(actor, document.order)) return true;
  if (
    actorRole(actor) === LOGISTICS_OPERATOR_ROLE
    && document.relatedModule === "SUPPLIER"
    && document.factoryDocumentRequestId
    && document.supplierId
    && document.supplierId === actor?.supplierId
  ) {
    return true;
  }
  const scope = effectivePermissions(actor).dataScope;
  if (scope === "ALL") return true;
  if (scope === "OWN") return canAccessOrder(actor, document.order);
  if (scope === "OWN_COST") return document.relatedModule === "SUPPLIER" && document.cost?.createdById === actor?.id;
  return false;
}

function isProtectedCustomsDocumentType(documentType: unknown = "") {
  return DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(normalizeOrderDocumentType(String(documentType || "")) as OrderDocumentType);
}

function isTaxRefundUploadSource(uploadSource: unknown = "") {
  return String(uploadSource || "").trim().toUpperCase() === "REACT_TAX_REFUND";
}

function canReadProtectedCustomsDocumentContent(actor: ActorLike, document: DocumentLike) {
  if (["管理员", "财务"].includes(actorRole(actor)) || isInternalLogisticsOperator(actor)) return true;
  if (actorRole(actor) === "业务员" && canRead(actor, "documents") && canAccessOrder(actor, document.order)) return true;
  return Boolean(
    isExternalLogisticsSupplierAccount(actor)
    && canRead(actor, "documents")
    && canRead(actor, "domesticLogistics")
    && canAccessDomesticLogisticsOrder(actor, document.order)
  );
}

export function canReadDocumentContent(actor: ActorLike, document: DocumentLike) {
  if (!canReadDocument(actor, document)) return false;
  if (isProtectedCustomsDocumentType(document.documentType)) {
    return canReadProtectedCustomsDocumentContent(actor, document);
  }
  return true;
}

export function orderDocumentFileInclude() {
  return Prisma.validator<Prisma.OrderDocumentInclude>()({
    order: {
      include: {
        customer: true,
        logisticsSuppliers: { select: { supplierId: true } },
        domesticLogisticsInfos: {
          include: {
            transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          },
        },
      },
    },
    cost: { include: { supplier: true } },
    supplier: true,
    uploadedBy: true,
  });
}

export async function resolveDocumentScope({ orderId, documentType, costId, supplierId, uploadSource = "" }: ResolvedDocumentScopeInput, actor: ActorLike) {
  documentType = normalizeOrderDocumentType(documentType);
  const relatedModule = relatedModuleForDocumentType(documentType);
  const order = await assertDocumentOrder(orderId, actor, documentType);
  if (["SUBMITTED", "COMPLETED", "ARCHIVED"].includes(order.taxRefundStatus)) throw permissionError("已提交退税档案只允许查看和下载资料");
  const scope = effectivePermissions(actor).dataScope;
  if (
    actorRole(actor) === "业务员"
    && isTaxRefundUploadSource(uploadSource)
    && !SALESPERSON_TAX_REFUND_UPLOAD_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)
  ) {
    throw permissionError("业务员在退税资料中只能上传本人客户的提单、装箱单、清关发票和销售合同");
  }
  if (actorRole(actor) === LOGISTICS_OPERATOR_ROLE && !DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) {
    throw permissionError("物流供应商不能上传该类资料");
  }
  if (actorRole(actor) === "财务" && DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)) {
    throw permissionError("财务只负责查看和下载报关资料，不参与上传");
  }
  if (documentType === "EXPORT_INVOICE" && !["管理员", "财务"].includes(actorRole(actor))) {
    throw permissionError("出口发票由财务上传，请联系财务人员处理");
  }
  if (actorRole(actor) === "财务" && relatedModule !== "SUPPLIER" && documentType !== "EXPORT_INVOICE") {
    throw permissionError("财务只负责查看和整理出口资料，不参与上传");
  }
  if (relatedModule === "SUPPLIER") {
    if (!["ALL", "OWN_COST"].includes(scope)) throw permissionError("无权限上传供应商资料");
    const cost = await prisma.orderCost.findFirst({
      where: {
        id: requireText(costId, "成本记录"),
        orderId: order.id,
        deletedAt: null,
      },
      include: { order: true, supplier: true },
    });
    if (!cost) throw permissionError("请选择有效供应商成本记录", 400);
    if (!cost.supplierId) throw permissionError("该成本记录未关联供应商，不能上传供应商资料", 400);
    if (supplierId && supplierId !== cost.supplierId) throw permissionError("供应商与成本记录不匹配", 400);
    if (scope === "OWN_COST" && cost.createdById !== actor?.id) throw permissionError("只能维护自己录入成本对应的资料");
    return { order, relatedModule, cost, supplierId: cost.supplierId };
  }
  if (!["ALL", "OWN"].includes(scope) && !(DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(documentType as OrderDocumentType) && canAccessDomesticLogisticsOrder(actor, order))) {
    throw permissionError("无权限上传出口资料或销售合同");
  }
  return { order, relatedModule, cost: null, supplierId: null };
}

export function isLogisticsGeneratedCostInvoice(documentType: string | null | undefined, cost: DocumentCostLike | null | undefined) {
  return documentType === "SUPPLIER_INVOICE" && cost?.sourceType === "LOGISTICS_EXPENSE";
}
