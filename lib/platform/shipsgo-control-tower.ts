import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { assertRead } from "./shared-auth";
import { nonEmpty } from "./shared-base-utils";
import {
  canAccessDomesticLogisticsOrder,
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";
import { orderSalespersonOwnershipWhere } from "./order-access";
import { serializeShipsgoTracking, type ShipsgoTrackingDto } from "./shipsgo-tracking-mapping";
import { cleanInputText, OCEAN_MODE, SHIPSGO_PROVIDER, type ShipsgoActor, type ShipsgoQueryLike } from "./shipsgo-tracking-utils";

function controlTowerQueryValue(query: ShipsgoQueryLike, key: string, limit = 128) {
  return cleanInputText(query?.get(key), limit);
}

function boolQueryValue(query: ShipsgoQueryLike, key: string) {
  const value = controlTowerQueryValue(query, key, 16).toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

function lowerIncludes(value: unknown, keyword: string) {
  if (!keyword) return true;
  return String(value || "").toLowerCase().includes(keyword.toLowerCase());
}

function trackingDateMs(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function startOfTodayMs(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function controlTowerOrderAccessWhere(actor: ShipsgoActor): Prisma.ReceivableOrderWhereInput {
  const role = nonEmpty(actor?.role);
  if (["管理员", "财务"].includes(role) || isInternalLogisticsOperator(actor)) return {};
  if (isExternalLogisticsSupplierAccount(actor)) {
    return actor.supplierId
      ? { logisticsSuppliers: { some: { supplierId: actor.supplierId } } }
      : { id: "__no_tracking_access__" };
  }
  if (role === "业务员") return orderSalespersonOwnershipWhere(nonEmpty(actor?.id));
  return { id: "__no_tracking_access__" };
}

function isShipsgoCompletedStatus(value: unknown) {
  return /ARRIVED|DISCHARGED|DELIVERED|COMPLETE|COMPLETED|CLOSED|FINISHED|已到港|已完成/i.test(nonEmpty(value));
}

function latestShipsgoTimelineEvent(timeline: ShipsgoTrackingDto["timeline"] = []) {
  return timeline.reduce<ShipsgoTrackingDto["timeline"][number] | null>((latest, event) => {
    if (!latest) return event;
    const latestTime = trackingDateMs(latest.time);
    const eventTime = trackingDateMs(event.time);
    if (eventTime != null && (latestTime == null || eventTime > latestTime)) return event;
    return latest;
  }, null);
}

function trackingSignalExists(tracking: ShipsgoTrackingDto) {
  return Boolean(
    tracking.eta
    || tracking.predictedDischargeDate
    || tracking.dateOfDischarge
    || tracking.lastEvent
    || tracking.timeline.length
  );
}

function trackingMatchesQuery(row: ShipsgoControlTowerRow, query: ShipsgoQueryLike) {
  const keyword = controlTowerQueryValue(query, "keyword", 100);
  const customer = controlTowerQueryValue(query, "customer", 100);
  const orderNo = controlTowerQueryValue(query, "orderNo", 100);
  const masterBlNo = controlTowerQueryValue(query, "masterBlNo", 100) || controlTowerQueryValue(query, "masterBl", 100);
  const carrier = controlTowerQueryValue(query, "carrier", 100);
  const origin = controlTowerQueryValue(query, "origin", 100);
  const destination = controlTowerQueryValue(query, "destination", 100);
  const status = controlTowerQueryValue(query, "status", 100);
  const etaStart = controlTowerQueryValue(query, "etaStart", 24);
  const etaEnd = controlTowerQueryValue(query, "etaEnd", 24);
  const overdue = boolQueryValue(query, "overdue");
  const syncFailed = boolQueryValue(query, "syncFailed");
  const etaMs = trackingDateMs(row.eta);
  const searchable = [
    row.orderNo,
    row.customerShortName,
    row.customerName,
    row.blNo,
    row.billOfLadingNo,
    row.masterBlNo,
    row.bookingNumber,
    row.carrierName,
    row.carrierScac,
    row.originName,
    row.destinationName,
    row.currentStatus,
    row.statusLabel,
    row.lastEvent,
    ...row.containerNumbers,
  ].join(" ");
  if (keyword && !lowerIncludes(searchable, keyword)) return false;
  if (customer && !lowerIncludes(`${row.customerShortName || ""} ${row.customerName || ""}`, customer)) return false;
  if (orderNo && !lowerIncludes(row.orderNo, orderNo)) return false;
  if (masterBlNo && !lowerIncludes(`${row.blNo || ""} ${row.billOfLadingNo || ""} ${row.masterBlNo || ""} ${row.bookingNumber || ""}`, masterBlNo)) return false;
  if (carrier && !lowerIncludes(`${row.carrierName || ""} ${row.carrierScac || ""}`, carrier)) return false;
  if (origin && !lowerIncludes(`${row.originName || ""} ${row.originPortName || ""} ${row.originPortCode || ""}`, origin)) return false;
  if (destination && !lowerIncludes(`${row.destinationName || ""} ${row.destinationPortName || ""} ${row.destinationPortCode || ""}`, destination)) return false;
  if (status && !lowerIncludes(`${row.currentStatus || ""} ${row.statusLabel || ""} ${row.alertLabels.join(" ")}`, status)) return false;
  if (etaStart) {
    const startMs = trackingDateMs(etaStart);
    if (startMs != null && (etaMs == null || etaMs < startMs)) return false;
  }
  if (etaEnd) {
    const endMs = trackingDateMs(`${etaEnd}T23:59:59`);
    if (endMs != null && (etaMs == null || etaMs > endMs)) return false;
  }
  if (overdue != null && row.isEtaOverdue !== overdue) return false;
  if (syncFailed != null && row.isSyncFailed !== syncFailed) return false;
  return true;
}

type ShipsgoControlTowerRow = ShipsgoTrackingDto & {
  orderNo: string;
  blNo: string;
  billOfLadingNo: string;
  customerName: string;
  customerShortName: string;
  businessEntityIsDefault: boolean;
  orderIsArchived: boolean;
  isCompleted: boolean;
  isSoonArriving: boolean;
  isEtaOverdue: boolean;
  isSyncStale: boolean;
  isSyncFailed: boolean;
  alertLabels: string[];
  latestNodeTime: string;
  latestNodeLocation: string;
  latestNodeDescription: string;
  containerCount: number;
};

function buildShipsgoControlTowerRow(row: Parameters<typeof serializeShipsgoTracking>[0] & {
  order?: {
    orderNo?: string | null;
    blNo?: string | null;
    customerNameSnapshot?: string | null;
    isArchived?: boolean | null;
    businessEntity?: { isDefault?: boolean | null } | null;
    customer?: { shortName?: string | null; name?: string | null } | null;
  } | null;
}, now = new Date()): ShipsgoControlTowerRow {
  const tracking = serializeShipsgoTracking(row);
  const latestEvent = latestShipsgoTimelineEvent(tracking.timeline);
  const etaMs = trackingDateMs(tracking.eta || tracking.predictedDischargeDate || tracking.dateOfDischarge);
  const todayMs = startOfTodayMs(now);
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const lastSyncMs = trackingDateMs(tracking.lastSyncTime || tracking.lastSyncedAt);
  const statusValue = tracking.currentStatus || tracking.status || tracking.statusLabel;
  const isSyncFailed = /FAIL|ERROR/.test(nonEmpty(tracking.syncStatus).toUpperCase());
  const isCompleted = isShipsgoCompletedStatus(statusValue);
  const isEtaOverdue = etaMs != null && etaMs < todayMs && !isCompleted;
  const isSoonArriving = etaMs != null && etaMs >= todayMs && etaMs - todayMs <= sevenDaysMs && !isCompleted;
  const isSyncStale = !isCompleted && (lastSyncMs == null || now.getTime() - lastSyncMs > 24 * 60 * 60 * 1000);
  const alertLabels = [
    isSyncFailed ? "同步失败" : "",
    isEtaOverdue ? "ETA 已过期" : "",
    isSoonArriving ? "即将到港" : "",
    isSyncStale ? "同步超时" : "",
  ].filter(Boolean);
  return {
    ...tracking,
    orderNo: row.order?.orderNo || "",
    blNo: row.order?.blNo || tracking.masterBlNo || tracking.bookingNumber || "",
    billOfLadingNo: row.order?.blNo || tracking.masterBlNo || tracking.bookingNumber || "",
    customerName: row.order?.customer?.name || row.order?.customerNameSnapshot || "",
    customerShortName: row.order?.customer?.shortName || row.order?.customerNameSnapshot || "",
    businessEntityIsDefault: typeof row.order?.businessEntity?.isDefault === "boolean"
      ? row.order.businessEntity.isDefault
      : true,
    orderIsArchived: row.order?.isArchived === true,
    isCompleted,
    isSoonArriving,
    isEtaOverdue,
    isSyncStale,
    isSyncFailed,
    alertLabels,
    latestNodeTime: latestEvent?.time || tracking.lastEventAt || "",
    latestNodeLocation: latestEvent?.location || "",
    latestNodeDescription: latestEvent?.description || tracking.lastEvent || "",
    containerCount: tracking.containerNumbers.length,
  };
}

export async function listShipsgoControlTowerTrackings(query: ShipsgoQueryLike, actor: ShipsgoActor) {
  assertRead(actor, "domesticLogistics");
  const includeCompleted = boolQueryValue(query, "includeCompleted") === true;
  const orderAccessWhere = controlTowerOrderAccessWhere(actor);
  const rows = await prisma.shipsgoTracking.findMany({
    where: {
      provider: SHIPSGO_PROVIDER,
      mode: OCEAN_MODE,
      deletedAt: null,
      shipsgoShipmentId: { not: null },
      order: { is: orderAccessWhere },
    },
    include: {
      containers: {
        select: { containerNo: true },
        orderBy: [{ containerNo: "asc" }],
      },
      order: {
        select: {
          id: true,
          orderNo: true,
          blNo: true,
          salespersonUserId: true,
          customerNameSnapshot: true,
          isArchived: true,
          businessEntity: { select: { isDefault: true } },
          customer: { select: { name: true, shortName: true, salespersonUserId: true } },
          logisticsSuppliers: { select: { supplierId: true } },
        },
      },
    },
    orderBy: [{ eta: "asc" }, { lastSyncTime: "desc" }, { updatedAt: "desc" }],
    take: 300,
  });
  const now = new Date();
  const mappedRows = rows
    .filter((row) => canAccessDomesticLogisticsOrder(actor, row.order))
    .map((row) => buildShipsgoControlTowerRow(row, now))
    .filter((row) => trackingSignalExists(row))
    .filter((row) => includeCompleted || !row.isCompleted)
    .filter((row) => trackingMatchesQuery(row, query))
    .sort((a, b) => {
      if (a.isSyncFailed !== b.isSyncFailed) return a.isSyncFailed ? -1 : 1;
      if (a.orderIsArchived !== b.orderIsArchived) return a.orderIsArchived ? 1 : -1;
      const aEta = trackingDateMs(a.eta);
      const bEta = trackingDateMs(b.eta);
      if (aEta == null && bEta == null) return 0;
      if (aEta == null) return 1;
      if (bEta == null) return -1;
      return aEta - bEta;
    });
  const todayStart = startOfTodayMs(now);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  return {
    rows: mappedRows,
    stats: {
      inTransitCount: mappedRows.filter((row) => !row.isCompleted).length,
      soonArrivingCount: mappedRows.filter((row) => row.isSoonArriving).length,
      etaOverdueCount: mappedRows.filter((row) => row.isEtaOverdue).length,
      syncFailedCount: mappedRows.filter((row) => row.isSyncFailed).length,
      syncedTodayCount: mappedRows.filter((row) => {
        const lastSync = trackingDateMs(row.lastSyncTime || row.lastSyncedAt);
        return lastSync != null && lastSync >= todayStart && lastSync < todayEnd;
      }).length,
    },
    updatedAt: now.toISOString(),
  };
}
