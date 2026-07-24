import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import {
  FACTORY_SUPPLIER_COST_TYPES,
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
  ORDER_COST_STATUS_VOID,
  TAX_REFUND_SUPPLIER_TYPES,
  codedError,
  findActiveFileAssetBySource,
  logServerError,
  nonEmpty,
} from "./shared";
import {
  SUPPLIER_DOCUMENT_EMAIL_LABELS,
  SUPPLIER_DOCUMENT_LABELS,
  supplierDocumentRequestFactoryCostInclude,
  supplierDocumentRequestFactoryCostWhere,
  uniqueEmails,
  type FactorySupplierReturnCost,
  type SupplierDocumentRequestInput,
  type SupplierDocumentRequestRow,
} from "./supplier-document-request-types";

export async function resolveUniqueFactoryCostForSupplierReturn(
  orderId: string,
  supplierId: string,
  costId = "",
) {
  if (costId) {
    const cost = await prisma.orderCost.findFirst({
      where: {
        id: costId,
        orderId,
        supplierId,
        deletedAt: null,
        status: { not: ORDER_COST_STATUS_VOID },
        costType: { in: FACTORY_SUPPLIER_COST_TYPES },
        supplier: { is: { supplierType: { in: TAX_REFUND_SUPPLIER_TYPES } } },
      },
      select: { id: true },
    });
    if (!cost) {
      throw codedError("请选择有效工厂货款资料位。", 400, "FACTORY_COST_SLOT_NOT_FOUND");
    }
    return cost;
  }
  const costs = await prisma.orderCost.findMany({
    where: {
      orderId,
      supplierId,
      deletedAt: null,
      status: { not: ORDER_COST_STATUS_VOID },
      costType: { in: FACTORY_SUPPLIER_COST_TYPES },
      supplier: { is: { supplierType: { in: TAX_REFUND_SUPPLIER_TYPES } } },
    },
    select: { id: true },
    take: 2,
  });
  return costs.length === 1 ? costs[0] : null;
}

export async function loadFactorySupplierReturnCostForRequest(
  input: SupplierDocumentRequestInput,
) {
  const costId = nonEmpty(input.costId || input.factoryCostId);
  const orderId = nonEmpty(input.orderId);
  const supplierId = nonEmpty(input.supplierId);
  if (!costId && (!orderId || !supplierId)) {
    throw codedError("请先选择已登记的工厂供应商成本。", 400, "FACTORY_COST_REQUIRED");
  }
  const cost = await prisma.orderCost.findFirst({
    where: supplierDocumentRequestFactoryCostWhere({ costId, orderId, supplierId }),
    include: supplierDocumentRequestFactoryCostInclude(),
    orderBy: [{ createdAt: "desc" }],
  });
  if (!cost) {
    throw codedError(
      "请先在成本管理登记该订单的工厂供应商成本，再创建资料回传任务。",
      400,
      "FACTORY_COST_REQUIRED",
    );
  }
  return cost;
}

export function supplierRecipientEmails(supplier: SupplierDocumentRequestRow["supplier"]) {
  return uniqueEmails([
    ...(supplier.operatorUsers || []).map((user) => user.email),
    supplier.email,
  ]);
}

export async function adminCcEmails() {
  const users = await prisma.user.findMany({
    where: { role: "管理员", isActive: true, approvalStatus: "APPROVED" },
    select: { email: true },
    take: 20,
  });
  return uniqueEmails(users.map((user) => user.email));
}

export function supplierDocumentEmailLabel(type: string) {
  return SUPPLIER_DOCUMENT_EMAIL_LABELS[type]
    || `${SUPPLIER_DOCUMENT_LABELS[type] || type}（PDF）`;
}

export function paymentVoucherAttachmentFileName(fileName = "", mimeType = "") {
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.endsWith(".png")
    ? "png"
    : lowerName.endsWith(".webp")
      ? "webp"
      : mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
          ? "webp"
          : "jpg";
  return `汇款水单.${extension}`;
}

export function isPaidFactorySupplierCost(cost: {
  paid?: boolean | null;
  paymentStatus?: string | null;
}) {
  return Boolean(cost.paid) || cost.paymentStatus === "已支付" || cost.paymentStatus === "部分支付";
}

export async function selectedProductSupplierPaymentVoucherAttachment(
  cost: FactorySupplierReturnCost,
) {
  if (!isPaidFactorySupplierCost(cost)) return null;
  const asset = await findActiveFileAssetBySource(
    FILE_ASSET_SOURCE_TABLES.ORDER_COSTS,
    cost.id,
    FILE_ASSET_ROLES.PAYMENT_VOUCHER,
  );
  const storageKey = asset?.storageKey || cost.paymentVoucherStorageKey || "";
  if (!storageKey) return null;
  const content = await readR2Object(storageKey).catch((error) => {
    logServerError("产品供应商资料回传通知付款凭证读取失败", error, {
      orderId: cost.orderId,
      supplierId: cost.supplierId || "",
      costId: cost.id,
    });
    return null;
  });
  if (!content) return null;
  const contentType = asset?.mimeType || cost.paymentVoucherMimeType || "image/jpeg";
  return {
    filename: paymentVoucherAttachmentFileName(
      asset?.fileName || cost.paymentVoucherFileName || "",
      contentType,
    ),
    content,
    contentType,
  };
}

export async function safeSelectedProductSupplierPaymentVoucherAttachment(
  cost: FactorySupplierReturnCost,
) {
  return selectedProductSupplierPaymentVoucherAttachment(cost).catch((error) => {
    logServerError("产品供应商资料回传通知付款凭证附件准备失败，已跳过水单附件", error, {
      orderId: cost.orderId,
      supplierId: cost.supplierId || "",
      costId: cost.id,
    });
    return null;
  });
}
