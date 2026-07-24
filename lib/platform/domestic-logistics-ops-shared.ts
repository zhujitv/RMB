import { Prisma } from "../generated/prisma/client.js";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  LEGACY_LOGISTICS_OPERATOR_ROLE,
  LOGISTICS_OPERATOR_ROLE,
  canRead,
  nonEmpty,
} from "./shared";
import { serializeShipsgoTrackingSummary } from "./shipsgo-tracking";
import { isExternalLogisticsSupplierAccount, isInternalLogisticsOperator } from "./masters-access";
import { orderOwnedBySalesperson } from "./order-access";

export type ActorLike = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
  supplierId?: string | null;
} | null | undefined;
export type QueryLike = {
  get(key: string): string | null;
} | null | undefined;
export type DomesticTransportInput = Record<string, unknown> & {
  containerNo?: string | null;
  containerType?: string | null;
  sealNo?: string | null;
  truckPlateNo?: string | null;
  trailerPlateNo?: string | null;
  departureDate?: unknown;
  departurePlace?: string | null;
  arrivalPlace?: string | null;
  destinationPlace?: string | null;
  cargoName?: string | null;
  cargoDescription?: string | null;
  remark?: string | null;
  sortOrder?: unknown;
};
export type DomesticLogisticsInput = DomesticTransportInput & {
  transportItems?: DomesticTransportInput[];
  transportType?: string;
  expressTrackingNo?: string;
  remarkText?: string;
  remarkTextManualEdited?: boolean | string;
};
export type NormalizedDomesticTransportItem = {
  containerNo: string | null;
  containerType: string | null;
  sealNo: string | null;
  truckPlateNo: string;
  trailerPlateNo: string | null;
  departureDate: Date;
  departurePlace: string;
  arrivalPlace: string;
  cargoName: string;
  remark: string | null;
  sortOrder: number;
};
export type DomesticLogisticsInfoLike = {
  remarkText?: string | null;
  submittedAt?: Date | string | null;
};
export type LogisticsSupplierRowLike = {
  supplierId?: string | null;
  supplier?: unknown;
};
export type LogisticsExpenseLike = {
  id?: string | null;
  billId?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  paymentStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
export type LogisticsBillLike = {
  id?: string | null;
  orderId?: string | null;
  supplierId?: string | null;
  auditStatus?: string | null;
  invoiceStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
type ShipsgoTrackingLike = Parameters<typeof serializeShipsgoTrackingSummary>[0];
export type DomesticOrderLike = {
  id?: string;
  orderNo?: string | null;
  blNo?: string | null;
  tradeTerm?: string | null;
  salespersonUserId?: string | null;
  customer?: { salespersonUserId?: string | null; country?: string | null } | null;
  customerNameSnapshot?: string | null;
  country?: string | null;
  logisticsSuppliers?: LogisticsSupplierRowLike[] | null;
  logisticsExpenses?: LogisticsExpenseLike[] | null;
  logisticsBills?: LogisticsBillLike[] | null;
  shipsgoTrackings?: ShipsgoTrackingLike[] | null;
  domesticLogisticsInfos?: DomesticLogisticsInfoLike[] | null;
  documents?: unknown[] | null;
  taxArchived?: boolean | null;
  isArchived?: boolean | null;
  taxRefundStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export function archiveScope(query: QueryLike) {
  const scope = nonEmpty(query?.get("archiveScope") || query?.get("businessScope") || query?.get("taxArchiveScope"));
  return ["current", "archive", "all"].includes(scope) ? scope : "current";
}

export function orderArchiveWhereForScope(scope = "current"): Prisma.ReceivableOrderWhereInput {
  if (scope === "archive") return { OR: [{ taxArchived: true }, { taxRefundStatus: "SUBMITTED" }] };
  if (scope === "all") return {};
  return { taxArchived: false };
}

export function orderLogisticsArchiveWhereForScope(scope = "current"): Prisma.ReceivableOrderWhereInput {
  if (scope === "archive") return { isArchived: true };
  if (scope === "all") return {};
  return { isArchived: false };
}

export function domesticLogisticsSelectWithRelations() {
  return Prisma.validator<Prisma.DomesticLogisticsInfoSelect>()({
    id: true,
    orderId: true,
    transportType: true,
    truckPlateNo: true,
    trailerPlateNo: true,
    departurePlace: true,
    destinationPlace: true,
    departureDate: true,
    expressTrackingNo: true,
    cargoDescription: true,
    remarkTextManualEdited: true,
    remarkText: true,
    submittedByUserId: true,
    submittedAt: true,
    submitterRole: true,
    financeStatus: true,
    financeConfirmedById: true,
    financeConfirmedAt: true,
    rejectReason: true,
    correctionRequested: true,
    correctionReason: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
    submittedBy: true,
    financeConfirmedBy: true,
    transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  });
}

export function domesticLogisticsSelectWithOrder() {
  return Prisma.validator<Prisma.DomesticLogisticsInfoSelect>()({
    ...domesticLogisticsSelectWithRelations(),
    order: { include: { customer: true, businessEntity: true, salesperson: true } },
  });
}

export function domesticLogisticsOrderInclude(options: { shipsgoTrackings?: boolean } = {}) {
  const includeShipsgoTrackings = options.shipsgoTrackings !== false;
  const include: Prisma.ReceivableOrderInclude = {
    customer: true,
    businessEntity: true,
    salesperson: true,
    domesticLogisticsInfos: {
      select: domesticLogisticsSelectWithRelations(),
      orderBy: [{ updatedAt: "desc" }],
      take: 1,
    },
    documents: {
      where: { deletedAt: null, documentType: { in: DOMESTIC_LOGISTICS_DOCUMENT_TYPES } },
      include: { uploadedBy: true },
      orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    },
    logisticsSuppliers: {
      include: { supplier: true },
      orderBy: [{ assignedAt: "desc" }],
    },
    logisticsBills: {
      where: { deletedAt: null, status: { not: "voided" } },
      select: {
        id: true,
        orderId: true,
        supplierId: true,
        auditStatus: true,
        invoiceStatus: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    },
    logisticsExpenses: {
      where: { deletedAt: null, bill: { is: { status: { not: "voided" } } } },
      select: {
        id: true,
        billId: true,
        orderId: true,
        supplierId: true,
        auditStatus: true,
        invoiceStatus: true,
        paymentStatus: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    },
  };
  if (includeShipsgoTrackings) {
    include.shipsgoTrackings = {
      where: { deletedAt: null },
      select: {
        id: true,
        orderId: true,
        provider: true,
        mode: true,
        shipsgoShipmentId: true,
        masterBlNo: true,
        reference: true,
        carrierScac: true,
        carrierName: true,
        bookingNumber: true,
        containerNumber: true,
        status: true,
        currentStatus: true,
        syncStatus: true,
        syncMessage: true,
        originName: true,
        destinationName: true,
        dateOfLoading: true,
        dateOfDischarge: true,
        predictedDischargeDate: true,
        eta: true,
        vesselName: true,
        voyage: true,
        mapUrl: true,
        lastEvent: true,
        lastEventAt: true,
        lastCheckedAt: true,
        lastSyncedAt: true,
        lastSyncTime: true,
        updatedAt: true,
        rawPayload: true,
        rawResponse: true,
        containers: {
          select: { containerNo: true },
          orderBy: [{ containerNo: "asc" }],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    };
  }
  return Prisma.validator<Prisma.ReceivableOrderInclude>()(include);
}

export function domesticLogisticsSubmitterRole(actor: ActorLike) {
  if (actor?.role === "管理员") return "ADMIN";
  if (actor?.role === "业务员") return "SALES";
  if ([LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE].includes(String(actor?.role || ""))) return "LOGISTICS_OPERATOR";
  return "";
}

export function canReadDomesticLogisticsOrder(actor: ActorLike, order: DomesticOrderLike = {}) {
  if (!canRead(actor, "domesticLogistics")) return false;
  if (["管理员", "财务"].includes(String(actor?.role || ""))) return true;
  if (isInternalLogisticsOperator(actor)) return true;
  if (isExternalLogisticsSupplierAccount(actor)) {
    const supplierId = actor?.supplierId || "";
    return (order.logisticsSuppliers || []).some((row) => row.supplierId === supplierId);
  }
  if (actor?.role === "业务员") {
    return orderOwnedBySalesperson({
      salespersonUserId: order?.salespersonUserId,
      customer: order?.customer,
    }, actor.id || "");
  }
  return false;
}
