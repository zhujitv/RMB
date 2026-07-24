import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  domesticLogisticsInfoSafeSelect,
  guardedPrismaFindMany,
  nonEmpty,
} from "./shared";
import type {
  TaxRefundDomesticLogisticsInfo,
  TaxRefundDomesticTransportItem,
  TaxRefundOrderWithRelations,
} from "./tax-refunds-model";

export function taxRefundDetailBillOfLadingNumbers(
  order: Pick<TaxRefundOrderWithRelations, "blNo"> & {
    logisticsBills?: Array<{ billOfLadingNo?: string | null }>;
  },
) {
  return [
    nonEmpty(order.blNo),
    ...(order.logisticsBills || []).map((bill) => nonEmpty(bill.billOfLadingNo)),
  ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
}

export function transportItemStableKey(item: TaxRefundDomesticTransportItem) {
  return item.id || [
    item.containerNo,
    item.containerType,
    item.truckPlateNo,
    item.trailerPlateNo,
    item.departureDate instanceof Date ? item.departureDate.toISOString() : item.departureDate,
    item.departurePlace,
    item.arrivalPlace,
    item.cargoName,
  ].map((value) => String(value || "")).join("|");
}

export function exportInvoiceContainerCount(info: TaxRefundDomesticLogisticsInfo) {
  const record = info.exportInvoice && typeof info.exportInvoice === "object"
    ? info.exportInvoice as Record<string, unknown>
    : {};
  const remark = record.remark && typeof record.remark === "object"
    ? record.remark as Record<string, unknown>
    : {};
  const containers = Array.isArray(remark.containers) ? remark.containers : [];
  return containers.length;
}

export function combineTaxRefundDomesticLogisticsInfos(infos: TaxRefundDomesticLogisticsInfo[]) {
  if (!infos.length) return [];
  const base = infos.find((info) => (info.transportItems || []).length) || infos[0];
  const seen = new Set<string>();
  const transportItems = infos.flatMap((info) => info.transportItems || []).filter((item) => {
    const key = transportItemStableKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [{
    ...base,
    exportInvoice: transportItems.length ? null : base.exportInvoice,
    transportItems,
  }];
}

export function warnIfArchivedLogisticsHasNoTransportItems(
  order: TaxRefundOrderWithRelations,
  billOfLadingNumbers: string[],
  infos: TaxRefundDomesticLogisticsInfo[],
) {
  const transportItemCount = infos.reduce((sum, info) => sum + (info.transportItems || []).length, 0);
  const structuredContainerCount = infos.reduce((sum, info) => sum + exportInvoiceContainerCount(info), 0);
  const hasArchivedLogistics = infos.some((info) => (
    nonEmpty(info.remarkText) || Boolean(info.exportInvoice) || info.submittedAt
  ));
  if (hasArchivedLogistics && transportItemCount === 0 && structuredContainerCount === 0) {
    console.warn("tax-refund-logistics-archived-without-transport-items", {
      orderId: order.id,
      orderNo: order.orderNo,
      billOfLadingNumbers,
    });
  }
}

export async function hydrateTaxRefundOrderLogisticsInfo(
  order: TaxRefundOrderWithRelations,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TaxRefundOrderWithRelations> {
  const orderBills = await guardedPrismaFindMany<Array<{ billOfLadingNo: string | null }>>(
    client.logisticsBill,
    "logisticsBill",
    "lib/platform/tax-refunds.ts:hydrateTaxRefundOrderLogisticsInfo.orderBills",
    {
      where: {
        orderId: order.id,
        deletedAt: null,
        status: { not: "voided" },
        NOT: { billOfLadingNo: "" },
      },
      select: { billOfLadingNo: true },
      orderBy: [{ createdAt: "asc" }],
      take: 50,
    },
  );
  const billOfLadingNumbers = taxRefundDetailBillOfLadingNumbers({
    ...order,
    logisticsBills: orderBills,
  });
  const relatedOrders = billOfLadingNumbers.length
    ? await guardedPrismaFindMany<Array<{
        id: string;
        domesticLogisticsInfos: TaxRefundDomesticLogisticsInfo[];
      }>>(
        client.receivableOrder,
        "receivableOrder",
        "lib/platform/tax-refunds.ts:hydrateTaxRefundOrderLogisticsInfo.relatedOrders",
        {
          where: {
            deletedAt: null,
            OR: [
              { id: order.id },
              { blNo: { in: billOfLadingNumbers } },
              {
                logisticsBills: {
                  some: {
                    deletedAt: null,
                    status: { not: "voided" },
                    billOfLadingNo: { in: billOfLadingNumbers },
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            domesticLogisticsInfos: {
              where: { deletedAt: null },
              select: domesticLogisticsInfoSafeSelect(),
              orderBy: [{ updatedAt: "desc" }],
            },
          },
          take: 100,
        },
      )
    : [{ id: order.id, domesticLogisticsInfos: order.domesticLogisticsInfos || [] }];
  const infoById = new Map<string, TaxRefundDomesticLogisticsInfo>();
  for (const info of order.domesticLogisticsInfos || []) infoById.set(info.id, info);
  for (const relatedOrder of relatedOrders) {
    for (const info of relatedOrder.domesticLogisticsInfos || []) infoById.set(info.id, info);
  }
  const infos = [...infoById.values()];
  warnIfArchivedLogisticsHasNoTransportItems(order, billOfLadingNumbers, infos);
  return {
    ...order,
    domesticLogisticsInfos: combineTaxRefundDomesticLogisticsInfos(infos),
  };
}
