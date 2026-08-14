import { Prisma } from "../generated/prisma/client.js";
import { assertBusinessNotArchived } from "./business-archive";
import { assertCommissionNotSettled } from "./commission-settlement-lock";
import {
  assertDomesticShipmentDateNotFuture,
  sameDomesticShipmentDate,
  shouldSyncDomesticShipmentDate,
} from "./domestic-logistics-shipment-sync";
import { orderStatusAfterShipment } from "./shared-order-collections";
import { writeAudit } from "./shared-audit";
import type { AuditRequestLike, DomesticLogisticsActor } from "./domestic-logistics-context";

export const domesticShipmentOrderSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true,
  orderNo: true,
  blNo: true,
  deletedAt: true,
  salespersonUserId: true,
  customer: { select: { salespersonUserId: true } },
  logisticsSuppliers: { select: { supplierId: true } },
  actualShipmentDate: true,
  status: true,
  taxArchived: true,
  taxRefundStatus: true,
  taxRefundArchivedAt: true,
  taxSubmittedAt: true,
  commissionStatus: true,
  commissionSettledAt: true,
  _count: {
    select: {
      commissionSettlementRecords: { where: { status: "ACTIVE", reversedAt: null } },
    },
  },
});

type ShipmentOrder = Prisma.ReceivableOrderGetPayload<{ select: typeof domesticShipmentOrderSelect }>;

export async function syncOrderFromDomesticDeparture(input: {
  tx: Prisma.TransactionClient;
  request: AuditRequestLike;
  actor: DomesticLogisticsActor;
  order: ShipmentOrder;
  domesticShipmentDate: Date;
  previousAutomaticDate: Date | null;
}) {
  const { tx, request, actor, order, domesticShipmentDate, previousAutomaticDate } = input;
  assertDomesticShipmentDateNotFuture(domesticShipmentDate);
  const syncDate = shouldSyncDomesticShipmentDate(order.actualShipmentDate, previousAutomaticDate)
    ? domesticShipmentDate : order.actualShipmentDate;
  const nextStatus = orderStatusAfterShipment(order.status);
  const dateChanged = !sameDomesticShipmentDate(syncDate, order.actualShipmentDate);
  if (!dateChanged && nextStatus === order.status) return;
  assertBusinessNotArchived(order,
    "该订单已提交退税并归档，不能通过物流修改发货时间；如需更正，请先取消退税归档。");
  assertCommissionNotSettled(order);
  const updatedOrder = await tx.receivableOrder.update({
    where: { id: order.id },
    data: { actualShipmentDate: syncDate, status: nextStatus, updatedById: actor.id },
    select: { actualShipmentDate: true, status: true },
  });
  await writeAudit(request, actor, "国内物流起运日期同步应收订单", "receivable_orders", order.id,
    { actualShipmentDate: order.actualShipmentDate, status: order.status }, updatedOrder, tx);
}
