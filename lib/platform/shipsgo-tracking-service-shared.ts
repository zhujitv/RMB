import { prisma } from "../prisma";
import { codedError } from "./shared-base-utils";
import { canAccessDomesticLogisticsOrder } from "./masters-access";
import {
  safeContainerNumber,
  uniqueStrings,
  type ShipsgoActor,
} from "./shipsgo-tracking-utils";
import type { writeAudit } from "./shared-audit";

export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ShipsgoTrackingOrder = Awaited<ReturnType<typeof getShipsgoTrackingOrder>>;

export async function getShipsgoTrackingOrder(orderId: string, actor: ShipsgoActor) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      salespersonUserId: true,
      customerNameSnapshot: true,
      customer: { select: { salespersonUserId: true, shortName: true, name: true } },
      logisticsSuppliers: { select: { supplierId: true } },
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        select: {
          id: true,
          transportItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { containerNo: true, containerType: true },
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!order) throw codedError("订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, order)) {
    throw codedError("无权限访问该订单物流信息。", 403, "PERMISSION_DENIED");
  }
  return order;
}

export function orderContainerNumbers(order: ShipsgoTrackingOrder) {
  return uniqueStrings((order.domesticLogisticsInfos || []).flatMap((info) => (
    info.transportItems || []
  ).map((item) => safeContainerNumber(item.containerNo))));
}

export async function replaceShipsgoTrackingContainers(trackingId: string, containerNumbers: string[]) {
  const cleanContainers = uniqueStrings(containerNumbers.map((containerNo) => safeContainerNumber(containerNo)));
  await prisma.$transaction([
    prisma.shipsgoTrackingContainer.deleteMany({ where: { trackingId } }),
    ...(cleanContainers.length ? [
      prisma.shipsgoTrackingContainer.createMany({
        data: cleanContainers.map((containerNo) => ({ trackingId, containerNo })),
        skipDuplicates: true,
      }),
    ] : []),
  ]);
}

export async function loadShipsgoTrackingWithContainers(id: string) {
  return prisma.shipsgoTracking.findUnique({
    where: { id },
    include: {
      containers: {
        select: { containerNo: true },
        orderBy: [{ containerNo: "asc" }],
      },
    },
  });
}
