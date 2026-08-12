import type { Prisma } from "../generated/prisma/client.js";
import { assertJsonObject, codedError } from "./shared";
import { PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";
import { resolveFactoryPurchaseOrderDispatchRecipients } from "./factory-purchase-order-dispatch-recipients";

export function normalizeFactoryPurchaseOrderReassignmentInput(input: unknown) {
  const body = assertJsonObject(input);
  const newSupplierId = String(body.newSupplierId || body.supplierId || "").trim();
  if (!newSupplierId) {
    throw codedError(
      "请选择新的产品供应商",
      400,
      "FACTORY_PURCHASE_ORDER_REASSIGN_SUPPLIER_REQUIRED",
    );
  }
  const value = body.expectedPurchaseOrderRevision ?? body.expectedOrderRevision;
  const expectedOrderRevision = Number(value);
  if (!Number.isSafeInteger(expectedOrderRevision) || expectedOrderRevision < 1) {
    throw codedError(
      "缺少有效的采购单版本，请刷新后重试",
      409,
      "FACTORY_PURCHASE_ORDER_REVISION_CONFLICT",
    );
  }
  return { body, newSupplierId, expectedOrderRevision };
}

export async function requireFactoryPurchaseOrderReplacementSupplier(
  tx: Prisma.TransactionClient,
  supplierId: string,
) {
  const supplier = await tx.supplier.findFirst({
    where: {
      id: supplierId,
      deletedAt: null,
      status: "启用",
      supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
      allowFactoryDocumentUpload: true,
    },
    select: {
      id: true,
      supplierName: true,
      purchasePaymentTerm: true,
      purchasePrepaymentRatio: true,
      purchasePrepaymentRequiredBeforeProduction: true,
    },
  });
  const recipients = supplier
    ? await resolveFactoryPurchaseOrderDispatchRecipients(tx, supplier.id)
    : { recipientEmails: [] as string[] };
  if (!supplier || !recipients.recipientEmails.length) {
    throw codedError(
      "新工厂未开启采购门户或缺少有效的已审核绑定账号",
      409,
      "FACTORY_PURCHASE_ORDER_REASSIGN_SUPPLIER_PORTAL_UNAVAILABLE",
    );
  }
  return supplier;
}
