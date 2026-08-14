import type { Prisma } from "../generated/prisma/client.js";
import { assertJsonObject, codedError } from "./shared";
import { PRODUCT_SUPPLIER_TYPES } from "./shared-party-constants";

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
    },
    select: {
      id: true,
      supplierName: true,
      purchasePaymentTerm: true,
      purchasePrepaymentRatio: true,
      purchasePrepaymentRequiredBeforeProduction: true,
    },
  });
  if (!supplier) {
    throw codedError(
      "新工厂不存在、已停用或不是产品供应商",
      409,
      "FACTORY_PURCHASE_ORDER_REASSIGN_SUPPLIER_INVALID",
    );
  }
  return supplier;
}
