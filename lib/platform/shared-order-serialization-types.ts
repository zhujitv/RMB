export type ShippingCustomerLike = {
  country?: string | null;
  clearanceEmailLanguage?: string | null;
  shippingDocsEmails?: unknown;
  shippingDocsCcEmails?: unknown;
  autoSendDocumentTypes?: unknown;
  shortName?: string | null;
  name?: string | null;
};

export type OrderDocumentLike = {
  id?: string;
  documentType?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
  mimeType?: string | null;
  uploadedAt?: Date | string | null;
  createdAt?: Date | string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  fileName?: string | null;
};

export type UserLike = {
  id?: string | null;
  name?: string | null;
};

export type OrderPaymentInstallmentLike = {
  condition?: unknown;
  ratio?: unknown;
  amount?: unknown;
};

export type OrderCostLike = Record<string, unknown>;
export type ShippingNotificationLike = Record<string, unknown>;

export type ShippingOrderLike = Record<string, unknown> & {
  id?: string | null;
  documents?: OrderDocumentLike[] | null;
  costs?: OrderCostLike[] | null;
  paymentInstallments?: unknown;
  customer?: ShippingCustomerLike | null;
  country?: string | null;
  currency?: string | null;
  exchangeRate?: unknown;
  exchangeRateDate?: Date | string | null;
  exchangeRateSource?: string | null;
  exchangeRateType?: string | null;
  estimatedReceivableAmount?: unknown;
  estimatedReceivableAmountCny?: unknown;
  actualShipmentAmount?: unknown;
  actualShipmentAmountCny?: unknown;
  actualShipmentDate?: Date | string | null;
  finalReceivableAmount?: unknown;
  finalReceivableAmountCny?: unknown;
  receivableAmount?: unknown;
  receivableAmountCny?: unknown;
  tradeTerm?: string | null;
  paymentTerm?: string | null;
  paymentTermType?: string | null;
  depositRatio?: unknown;
  expectedPaymentDate?: Date | string | null;
  expectedArrivalDate?: Date | string | null;
  expectedShipmentDate?: Date | string | null;
  blDate?: Date | string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  customsDeclarationDate?: Date | null;
  orderNo?: string | null;
  customerId?: string | null;
  customerNameSnapshot?: string;
  businessEntityId?: string | null;
  businessEntityNameSnapshot?: string | null;
  businessEntity?: {
    id?: string | null;
    name?: string | null;
    shortName?: string | null;
    isDefault?: boolean | null;
    status?: string | null;
  } | null;
  salespersonUserId?: string | null;
  salesperson?: UserLike | null;
  salespersonCommissionRate?: unknown;
  commissionStatus?: string | null;
  commissionSettledById?: string | null;
  commissionSettledBy?: UserLike | null;
  commissionSettledAt?: Date | string | null;
  commissionSettlementRemark?: string | null;
  taxArchived?: boolean | null;
  taxRefundStatus?: string | null;
  taxRefundArchivedAt?: Date | string | null;
  taxRefundArchivedById?: string | null;
  taxRefundArchivedBy?: UserLike | null;
  taxRefundArchiveRemark?: string | null;
  taxSubmittedById?: string | null;
  taxSubmittedBy?: UserLike | null;
  taxSubmittedAt?: Date | string | null;
  domesticLogisticsInfos?: unknown[] | null;
  logisticsSuppliers?: Array<{ supplierId?: string | null; supplier?: unknown }> | null;
  shippingDocumentNotifications?: ShippingNotificationLike[] | null;
  creditDays?: unknown;
  dueDate?: Date | string | null;
  reminderDays?: unknown;
  status?: string | null;
  remark?: string | null;
  createdBy?: unknown;
  updatedBy?: unknown;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type ShippingDocumentBundleItem = {
  typeKey: string;
  label: string;
  emailLabel: string;
  documentType: string;
  document: OrderDocumentLike | null;
};

export type ShippingDocumentBundle = {
  items: ShippingDocumentBundleItem[];
  documents: OrderDocumentLike[];
  missing: ShippingDocumentBundleItem[];
};

export function asShippingOrder(value: unknown): ShippingOrderLike {
  return (value && typeof value === "object" ? value : {}) as ShippingOrderLike;
}
