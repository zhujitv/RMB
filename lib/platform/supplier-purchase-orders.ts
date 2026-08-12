import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertRead, assertWrite, canWrite } from "./shared-access";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-errors";
import { nonEmpty } from "./shared-base-utils";
import { pageParams, pageResult } from "./shared-permission-data";
import {
  PRODUCT_SUPPLIER_OPERATOR_ROLES,
  PRODUCT_SUPPLIER_TYPES,
} from "./shared-party-constants";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { effectiveFactoryPurchaseOrderAmount, factoryPrepaymentRequiredAmount } from "./factory-purchase-order-financials";
import {
  normalizeSupplierPurchaseOrderResponse,
  normalizeSupplierPurchaseOrderPrices,
  serializeSupplierPurchaseOrder,
  type SupplierPurchaseOrderPublicRow,
} from "./supplier-purchase-orders-values";
import {
  supplierPurchaseOrderPublicSelect,
  supplierPurchaseOrderScope,
  type SelectedSupplierPurchaseOrder,
  visibleSupplierPurchaseOrderStatus,
} from "./supplier-purchase-orders-query";
export type SupplierPurchaseOrderActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type QueryLike = Pick<URLSearchParams, "get">;
type AuditRequest = Parameters<typeof writeAudit>[0];
function publicDto(row: SelectedSupplierPurchaseOrder) {
  return serializeSupplierPurchaseOrder(row as SupplierPurchaseOrderPublicRow);
}

export async function assertActiveSupplierPurchaseOrderActor(
  tx: Prisma.TransactionClient,
  actorId: string,
  supplierId: string,
) {
  // Keep account and supplier eligibility stable until the purchase-order
  // response commits. Otherwise an administrator could disable/rebind the
  // account after this check while the stale request still succeeds.
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${actorId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "suppliers" WHERE "id" = ${supplierId} FOR SHARE`;
  const validActor = await tx.user.findFirst({
    where: {
      id: actorId,
      supplierId,
      role: { in: [...PRODUCT_SUPPLIER_OPERATOR_ROLES] },
      isActive: true, approvalStatus: "APPROVED", emailVerified: true,
      mustChangePassword: false, passwordPolicyPassed: true, deletedAt: null,
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
}
export async function listSupplierPurchaseOrders(query: QueryLike | null | undefined, actor: SupplierPurchaseOrderActor) {
  assertRead(actor, "supplierPurchaseOrders");
  const scope = supplierPurchaseOrderScope(actor);
  const { page, pageSize } = pageParams(query, 20, 50);
  const keyword = nonEmpty(query?.get("keyword") || query?.get("q"));
  const status = visibleSupplierPurchaseOrderStatus(query?.get("status"));
  const where: Prisma.FactoryPurchaseOrderWhereInput = {
    ...scope,
    ...(keyword ? {
      OR: [
        { poNo: { contains: keyword, mode: "insensitive" } },
        { execution: { is: { customerOrderNo: { contains: keyword, mode: "insensitive" } } } },
      ],
    } : {}),
    ...(status ? { status } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.factoryPurchaseOrder.count({ where }),
    prisma.factoryPurchaseOrder.findMany({
      where,
      select: supplierPurchaseOrderPublicSelect,
      orderBy: [{ dispatchedAt: "desc" }, { poNo: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return pageResult(rows.map(publicDto), total, page, pageSize);
}
async function findSupplierPurchaseOrder(
  id: string,
  actor: SupplierPurchaseOrderActor,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return client.factoryPurchaseOrder.findFirst({
    where: { id: nonEmpty(id), ...supplierPurchaseOrderScope(actor) },
    select: supplierPurchaseOrderPublicSelect,
  });
}
export async function getSupplierPurchaseOrder(id: string, actor: SupplierPurchaseOrderActor) {
  assertRead(actor, "supplierPurchaseOrders");
  const row = await findSupplierPurchaseOrder(id, actor);
  if (!row) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
  return publicDto(row);
}
export async function respondToSupplierPurchaseOrder(
  request: AuditRequest,
  actor: SupplierPurchaseOrderActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "supplierPurchaseOrders");
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  const supplierId = nonEmpty(actor?.supplierId);
  if (!supplierId) throw codedError("供应商账号未绑定工厂", 403, "SUPPLIER_ACCOUNT_NOT_BOUND");

  try {
    return await prisma.$transaction(async (tx) => {
      await assertActiveSupplierPurchaseOrderActor(tx, actorId, supplierId);
      const scoped = await findSupplierPurchaseOrder(id, actor, tx);
      if (!scoped) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      await tx.$queryRaw`SELECT "id" FROM "factory_purchase_orders" WHERE "id" = ${scoped.id} FOR UPDATE`;
      const before = await findSupplierPurchaseOrder(scoped.id, actor, tx);
      if (!before) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      if (!(before.status === "DISPATCHED" || before.status === "ACCEPTED" || before.status === "DELIVERY_PROPOSED")) {
        throw codedError("该采购单当前不能再次回复", 409, "SUPPLIER_PURCHASE_ORDER_RESPONSE_NOT_ALLOWED");
      }
      if (before.execution.shippingStartedAt || before.productionStatus === "COMPLETED" || before.actualDeliveryDate) {
        throw codedError("该采购单已经进入交付阶段，不能再次变更交期", 409, "SUPPLIER_PURCHASE_ORDER_DELIVERY_FROZEN");
      }
      if (before.status === "DELIVERY_PROPOSED") {
        throw codedError("上一次新交期正在等待内部确认，请勿重复提交", 409, "SUPPLIER_PURCHASE_ORDER_PROPOSAL_PENDING");
      }
      const response = normalizeSupplierPurchaseOrderResponse(
        input,
        before.confirmedSupplierDeliveryDate || before.supplierDeliveryDate || before.requestedDeliveryDate,
      );
      if (before.status !== "DISPATCHED" && response.action !== "DELIVERY_PROPOSED") {
        throw codedError("已回复采购单只允许再次变更交货期", 409, "SUPPLIER_PURCHASE_ORDER_ONLY_DELIVERY_CHANGE_ALLOWED");
      }
      if (response.expectedRevision !== before.revision) {
        throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
      }
      const priceRows = response.action === "REJECTED"
        ? []
        : normalizeSupplierPurchaseOrderPrices(input, before.items);
      const suppliedPriceByItem = new Map(priceRows.map((row) => [row.purchaseOrderItemId, row.unitPriceText]));
      const effectiveItems = before.items.map((item) => {
        const suppliedUnitPrice = suppliedPriceByItem.get(item.id);
        return {
          amount: item.amount,
          supplierPrice: suppliedUnitPrice === undefined
            ? item.supplierPrice
            : { amount: new Prisma.Decimal(suppliedUnitPrice).mul(item.allocatedQuantity).toDecimalPlaces(2) },
        };
      });
      const firstAcceptedResponse = response.action === "ACCEPTED" && !before.initialSupplierDeliveryDate;
      const freezePenaltyBase = response.action === "ACCEPTED" && before.penaltyBaseAmount === null;
      const penaltyBaseAmount = freezePenaltyBase
        ? effectiveFactoryPurchaseOrderAmount(effectiveItems)
        : before.penaltyBaseAmount;
      if (freezePenaltyBase && penaltyBaseAmount === null) {
        throw codedError("采购单金额尚未完整，不能确认首次交期", 409, "FACTORY_PURCHASE_ORDER_PENALTY_BASE_INCOMPLETE");
      }
      const respondedAt = new Date();
      if (response.action === "REJECTED") {
        const staleSendingBefore = new Date(respondedAt.getTime() - 5 * 60 * 1000);
        await tx.notificationOutbox.updateMany({
          where: {
            type: NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH,
            relatedEntityType: "factory_purchase_order",
            relatedEntityId: before.id,
            OR: [
              { status: { in: ["queued", "failed", "pending"] } },
              { status: "sending", updatedAt: { lte: staleSendingBefore } },
            ],
          },
          data: {
            status: "cancelled",
            lastError: "采购单已由供应商拒绝，未发送通知已取消",
          },
        });
      }
      const responseSequence = before.supplierResponseSequence + 1;
      const responseHistory = await tx.factoryPurchaseOrderSupplierResponse.create({
        data: {
          purchaseOrderId: before.id,
          responseSequence,
          action: response.action,
          deliveryDate: response.deliveryDate,
          remark: response.remark || null,
          respondedById: actorId,
          respondedAt,
        },
      });
      for (const price of priceRows) {
        const item = before.items.find((candidate) => candidate.id === price.purchaseOrderItemId);
        if (!item) {
          throw codedError("价格回填包含无效采购明细", 400, "SUPPLIER_PURCHASE_ORDER_PRICE_ITEM_INVALID");
        }
        const unitPrice = new Prisma.Decimal(price.unitPriceText);
        await tx.factoryPurchaseOrderSupplierPrice.create({
          data: {
            purchaseOrderId: before.id,
            purchaseOrderItemId: item.id,
            supplierResponseId: responseHistory.id,
            unitPrice,
            amount: unitPrice.mul(item.allocatedQuantity).toDecimalPlaces(2),
            confirmedById: actorId,
            confirmedAt: respondedAt,
          },
        });
      }
      const changed = await tx.factoryPurchaseOrder.updateMany({
        where: {
          id: before.id,
          supplierId,
          status: before.status,
          dispatchedAt: { not: null },
          revision: response.expectedRevision,
          supplierResponseSequence: before.supplierResponseSequence,
          supplier: {
            is: {
              deletedAt: null,
              status: "启用",
              supplierType: { in: [...PRODUCT_SUPPLIER_TYPES] },
            },
          },
        },
        data: {
          status: response.action,
          supplierDeliveryDate: response.action === "ACCEPTED" ? response.deliveryDate : before.supplierDeliveryDate,
          supplierResponseRemark: response.remark || null,
          supplierResponseSequence: responseSequence,
          respondedAt,
          respondedById: actorId,
          ...(firstAcceptedResponse ? {
            initialSupplierDeliveryDate: response.deliveryDate,
          } : {}),
          ...(response.action === "ACCEPTED" ? {
            confirmedSupplierDeliveryDate: response.deliveryDate,
          } : {}),
          ...(freezePenaltyBase ? {
            penaltyBaseAmount,
          } : {}),
          ...(response.action === "REJECTED" ? {
            dispatchEmailStatus: before.dispatchEmailStatus === "SENT" ? "SENT" : "CANCELLED",
            dispatchEmailError:
              before.dispatchEmailStatus === "SENT"
                ? before.dispatchEmailError
                : "采购单已由供应商拒绝，未发送通知已取消",
          } : {}),
          ...(response.action === "ACCEPTED" && (firstAcceptedResponse || freezePenaltyBase) ? {
            productionStatus:
              before.prepaymentRequiredBeforeProduction && factoryPrepaymentRequiredAmount(penaltyBaseAmount, before.prepaymentRatio).gt(0)
                ? "WAITING_PREPAYMENT"
                : "READY",
          } : {}),
          revision: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (changed.count !== 1) {
        throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
      }
      const saved = await findSupplierPurchaseOrder(before.id, actor, tx);
      if (!saved) throw codedError("采购单不存在或不可访问", 404, "SUPPLIER_PURCHASE_ORDER_NOT_FOUND");
      const beforeDto = publicDto(before);
      const savedDto = publicDto(saved);
      await writeAudit(
        request,
        { id: actorId },
        "供应商回复工厂采购单",
        "factory_purchase_orders",
        before.id,
        beforeDto,
        savedDto,
        tx,
      );
      return savedDto;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "P2034") {
      throw codedError("采购单状态已变化，请刷新后重试", 409, "SUPPLIER_PURCHASE_ORDER_REVISION_CONFLICT");
    }
    throw error;
  }
}
