import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite, canWrite } from "./shared-access";
import { codedError, isPlainRecord } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import {
  PRODUCT_SUPPLIER_OPERATOR_ROLES,
  PRODUCT_SUPPLIER_TYPES,
} from "./shared-party-constants";
import type { SupplierPurchaseOrderActor } from "./supplier-purchase-orders";
import {
  serializeSupplierPurchaseOrder,
  type SupplierPurchaseOrderPublicRow,
} from "./supplier-purchase-orders-values";

type AuditRequest = Parameters<typeof writeAudit>[0];

const supplierProductionOrderSelect = Prisma.validator<Prisma.FactoryPurchaseOrderSelect>()({
  id: true,
  supplierId: true,
  revision: true,
  poNo: true,
  supplierResponseSequence: true,
  dispatchedAt: true,
  purchaseCurrency: true,
  requestedDeliveryDate: true,
  paymentTerm: true,
  prepaymentRatio: true,
  prepaymentRequiredBeforeProduction: true,
  initialSupplierDeliveryDate: true,
  confirmedSupplierDeliveryDate: true,
  actualDeliveryDate: true,
  actualDeliveryRecordedAt: true,
  penaltyBaseAmount: true,
  delayGraceDays: true,
  delayPenaltyRatePerDay: true,
  delayPenaltyCapRatio: true,
  productionStatus: true,
  productionStartedAt: true,
  productionCompletedAt: true,
  productionCompletedById: true,
  remark: true,
  status: true,
  supplierDeliveryDate: true,
  supplierResponseRemark: true,
  respondedAt: true,
  execution: { select: { customerOrderNo: true, shippingStartedAt: true } },
  supplierResponses: {
    orderBy: [{ responseSequence: "asc" }],
    select: {
      responseSequence: true,
      action: true,
      deliveryDate: true,
      remark: true,
      respondedAt: true,
      internalDecision: true,
      internalDecisionRemark: true,
      internalDecidedAt: true,
    },
  },
  payments: {
    where: { status: "CONFIRMED", kind: "PREPAYMENT" },
    select: { amount: true },
  },
  items: {
    orderBy: [{ lineNumber: "asc" }],
    select: {
      id: true,
      productNameSnapshot: true,
      specificationSnapshot: true,
      unitSnapshot: true,
      allocatedQuantity: true,
      purchaseUnitPrice: true,
      amount: true,
      supplierPrice: {
        select: { unitPrice: true, amount: true, confirmedAt: true },
      },
      remark: true,
    },
  },
});

type SupplierProductionOrder = Prisma.FactoryPurchaseOrderGetPayload<{
  select: typeof supplierProductionOrderSelect;
}>;

function expectedRevisionFrom(input: unknown) {
  if (!isPlainRecord(input)) {
    throw codedError("生产完成确认内容格式错误", 400, "SUPPLIER_PRODUCTION_COMPLETION_INVALID");
  }
  const expectedRevision = input.expectedRevision;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw codedError("采购单版本号无效，请刷新后重试", 400, "SUPPLIER_PURCHASE_ORDER_REVISION_INVALID");
  }
  return expectedRevision;
}

function supplierOrderWhere(id: string, supplierId: string): Prisma.FactoryPurchaseOrderWhereInput {
  return {
    id: nonEmpty(id),
    supplierId,
    dispatchedAt: { not: null },
    supplier: {
      is: {
        deletedAt: null,
        status: "启用",
        supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
        allowFactoryDocumentUpload: true,
      },
    },
  };
}

async function findSupplierProductionOrder(
  tx: Prisma.TransactionClient,
  id: string,
  supplierId: string,
) {
  return tx.factoryPurchaseOrder.findFirst({
    where: supplierOrderWhere(id, supplierId),
    select: supplierProductionOrderSelect,
  });
}

function publicDto(row: SupplierProductionOrder) {
  return serializeSupplierPurchaseOrder(row as SupplierPurchaseOrderPublicRow);
}

function completionAuditState(row: SupplierProductionOrder) {
  return {
    revision: row.revision,
    productionStatus: row.productionStatus,
    productionCompletedAt: row.productionCompletedAt,
    productionCompletedById: row.productionCompletedById,
  };
}

export async function completeSupplierPurchaseOrderProduction(
  request: AuditRequest,
  actor: SupplierPurchaseOrderActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "supplierPurchaseOrders");
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  const supplierId = nonEmpty(actor?.supplierId);
  if (!supplierId) {
    throw codedError("供应商账号未绑定工厂", 403, "SUPPLIER_ACCOUNT_NOT_BOUND");
  }
  const expectedRevision = expectedRevisionFrom(input);

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${actorId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "suppliers" WHERE "id" = ${supplierId} FOR SHARE`;
      const validActor = await tx.user.findFirst({
        where: {
          id: actorId,
          supplierId,
          role: { in: [...PRODUCT_SUPPLIER_OPERATOR_ROLES] },
          isActive: true,
          approvalStatus: "APPROVED",
          emailVerified: true,
          mustChangePassword: false,
          passwordPolicyPassed: true,
          deletedAt: null,
          supplierOperator: {
            is: {
              id: supplierId,
              deletedAt: null,
              status: "启用",
              supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
              allowFactoryDocumentUpload: true,
            },
          },
        },
        select: { id: true, role: true, customPermissions: true },
      });
      if (!validActor || !canWrite(validActor, "supplierPurchaseOrders")) {
        throw codedError("供应商账号已失效或绑定信息已变更", 403, "SUPPLIER_ACCOUNT_NOT_ACTIVE");
      }

      const scoped = await findSupplierProductionOrder(tx, id, supplierId);
      if (!scoped) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findSupplierProductionOrder(tx, scoped.id, supplierId);
      if (!before) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      if (before.status !== "ACCEPTED") {
        throw codedError("只有已确认的有效采购单可以确认生产完成", 409, "SUPPLIER_PRODUCTION_PURCHASE_ORDER_NOT_ACTIVE");
      }
      if (before.productionStatus === "COMPLETED") {
        return publicDto(before);
      }
      if (before.productionStatus !== "IN_PRODUCTION") {
        throw codedError("只有生产中的采购单可以确认生产完成", 409, "SUPPLIER_PRODUCTION_NOT_IN_PROGRESS");
      }
      if (before.revision !== expectedRevision) {
        throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
      }

      const productionCompletedAt = new Date();
      const changed = await tx.factoryPurchaseOrder.updateMany({
        where: {
          id: before.id,
          supplierId,
          status: "ACCEPTED",
          productionStatus: "IN_PRODUCTION",
          productionCompletedAt: null,
          productionCompletedById: null,
          revision: expectedRevision,
          supplier: {
            is: {
              deletedAt: null,
              status: "启用",
              supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
              allowFactoryDocumentUpload: true,
            },
          },
        },
        data: {
          productionStatus: "COMPLETED",
          productionCompletedAt,
          productionCompletedById: actorId,
          revision: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (changed.count !== 1) {
        throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
      }

      const saved = await findSupplierProductionOrder(tx, before.id, supplierId);
      if (!saved) {
        throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      }
      await writeAudit(
        request,
        { id: actorId },
        "供应商确认工厂采购单生产完成",
        "factory_purchase_orders",
        before.id,
        completionAuditState(before),
        completionAuditState(saved),
        tx,
      );
      return publicDto(saved);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
    }
    throw error;
  }
}
