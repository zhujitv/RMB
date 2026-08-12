import type { Prisma } from "../generated/prisma/client.js";
import { uniqueEmails } from "./notification-helpers";
import { effectivePermissions } from "./shared-permission-data";
import {
  PRODUCT_SUPPLIER_OPERATOR_ROLES,
  PRODUCT_SUPPLIER_TYPES,
} from "./shared-party-constants";

type FactoryPortalOperator = {
  email?: string | null;
  role?: string | null;
  customPermissions?: unknown;
};

export function canOperateFactoryPurchaseOrderPortal(user: FactoryPortalOperator) {
  const permissions = effectivePermissions(user);
  return permissions.menus.includes("supplierPurchaseOrders")
    && Boolean(permissions.reads.supplierPurchaseOrders)
    && Boolean(permissions.writes.supplierPurchaseOrders);
}

export async function resolveFactoryPurchaseOrderDispatchRecipients(
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
      operatorUsers: {
        where: {
          role: { in: [...PRODUCT_SUPPLIER_OPERATOR_ROLES] },
          isActive: true,
          deletedAt: null,
          approvalStatus: "APPROVED",
        },
        select: { email: true, role: true, customPermissions: true },
      },
    },
  });
  if (!supplier) {
    return {
      recipientEmails: [] as string[],
      blockedReason: "工厂已停用、门户已关闭或不存在",
    };
  }
  const operatorEmails = uniqueEmails(
    supplier.operatorUsers
      .filter(canOperateFactoryPurchaseOrderPortal)
      .map((user) => user.email),
  );
  if (!operatorEmails.length) {
    return {
      recipientEmails: [] as string[],
      blockedReason: "工厂未配置可处理采购单的有效门户账号邮箱",
    };
  }
  return {
    recipientEmails: operatorEmails,
    blockedReason: "",
  };
}
