import { Prisma } from "../generated/prisma/client.js";
import {
  cachedTaxRefundCompleteness,
  domesticLogisticsInfoSafeSelect,
  includeOrderRelations,
  standardFilenameForDocument,
  writeAudit,
} from "./shared";

export type TaxRefundCompletenessOrder = Parameters<typeof cachedTaxRefundCompleteness>[0];
export type TaxRefundSortableOrder = TaxRefundCompletenessOrder & {
  taxRefundStatus?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
};
export type TaxRefundActionInput = Record<string, unknown>;
export type StandardFilenameOrder = Parameters<typeof standardFilenameForDocument>[1];
export type QueryLike = URLSearchParams;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
export type TaxRefundListMode = "current" | "archive";
export type TaxRefundListFilters = {
  page: number;
  pageSize: number;
  keyword: string;
  mode: TaxRefundListMode;
  statusFilter: string;
  businessEntityId: string;
  declarationMonthStart: Date | null;
  declarationMonthEnd: Date | null;
};

export const taxRefundLightListSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true,
  orderNo: true,
  blNo: true,
  customerNameSnapshot: true,
  businessEntityId: true,
  businessEntityNameSnapshot: true,
  currency: true,
  customsDeclarationDate: true,
  taxRefundStatus: true,
  taxRefundCompleteness: true,
  taxRefundCompletenessUpdatedAt: true,
  taxRefundOverallCompleteness: true,
  taxRefundCompletenessIssuesSummary: true,
  taxArchived: true,
  taxRefundArchivedAt: true,
  taxRefundArchiveRemark: true,
  taxSubmittedAt: true,
  customer: { select: { name: true, shortName: true } },
  businessEntity: { select: { id: true, name: true, shortName: true, isDefault: true } },
});
export type TaxRefundLightListOrder = Prisma.ReceivableOrderGetPayload<{
  select: typeof taxRefundLightListSelect;
}>;

export const taxRefundDocumentLightSelect = Prisma.validator<Prisma.OrderDocumentSelect>()({
  id: true,
  orderId: true,
  costId: true,
  supplierId: true,
  factoryDocumentRequestId: true,
  relatedModule: true,
  documentType: true,
  fileName: true,
  originalName: true,
  originalFilename: true,
  standardFilename: true,
  fileSize: true,
  mimeType: true,
  uploadStatus: true,
  uploadProgress: true,
  uploadedAt: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, name: true } },
  supplier: { select: { id: true, supplierName: true, supplierType: true } },
  cost: {
    select: {
      id: true,
      supplierNameSnapshot: true,
      costType: true,
      supplier: { select: { id: true, supplierName: true, supplierType: true } },
    },
  },
});

export const taxRefundCostLightSelect = Prisma.validator<Prisma.OrderCostSelect>()({
  id: true,
  orderId: true,
  supplierId: true,
  supplierNameSnapshot: true,
  costType: true,
  vendorName: true,
  currency: true,
  exchangeRate: true,
  exchangeRateDate: true,
  exchangeRateSource: true,
  exchangeRateType: true,
  amount: true,
  amountCny: true,
  status: true,
  voidedAt: true,
  voidReason: true,
  paymentStatus: true,
  costConfirmed: true,
  costConfirmedAt: true,
  paymentDate: true,
  paid: true,
  paidAt: true,
  invoiceStatus: true,
  sourceType: true,
  sourceId: true,
  remark: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, supplierName: true, supplierType: true } },
  documents: {
    where: { deletedAt: null },
    select: taxRefundDocumentLightSelect,
    orderBy: [{ documentType: "asc" }, { createdAt: "desc" }],
    take: 50,
  },
});

export type TaxRefundDocumentLight = Prisma.OrderDocumentGetPayload<{
  select: typeof taxRefundDocumentLightSelect;
}>;
export type TaxRefundCostLight = Prisma.OrderCostGetPayload<{
  select: typeof taxRefundCostLightSelect;
}>;
export type TaxRefundPackageDocument = Prisma.OrderDocumentGetPayload<{
  include: { uploadedBy: true; cost: { include: { supplier: true } }; supplier: true };
}>;
export type TaxRefundPackageOrder = Prisma.ReceivableOrderGetPayload<{
  include: {
    customer: true;
    businessEntity: true;
    documents: {
      include: { uploadedBy: true; cost: { include: { supplier: true } }; supplier: true };
    };
  };
}>;
export type TaxRefundOrderWithRelations = Prisma.ReceivableOrderGetPayload<{
  include: ReturnType<typeof includeOrderRelations>;
}>;
export type TaxRefundDomesticLogisticsInfo = Prisma.DomesticLogisticsInfoGetPayload<{
  select: ReturnType<typeof domesticLogisticsInfoSafeSelect>;
}>;
export type TaxRefundDomesticTransportItem = TaxRefundDomesticLogisticsInfo["transportItems"][number];

export const TAX_REFUND_LOGISTICS_INVOICE_COST_TYPES = [
  "报关费",
  "拖车费",
  "国内物流费",
  "国内拖车费",
  "港杂费",
  "海运费",
];
export const TAX_REFUND_SUPPLIER_DOCUMENT_LIMIT = 160;
