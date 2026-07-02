import type { ExportInvoiceRemark } from "../../components";

export const PRODUCT_SUPPLIER_TYPES = ["产品供应商", "工厂供应商"];

export type DocumentCompleteness = {
  completed?: number;
  total?: number;
  missingLabels?: string[];
  missing?: string[];
  export?: { missingTypes?: string[] };
  customs?: { missingTypes?: string[] };
  domesticLogistics?: { missing?: unknown[] };
  supplier?: {
    missing?: Array<{
      costId?: string;
      supplierId?: string;
      supplierName?: string;
      documentType?: string;
      label?: string;
      missingFactoryCost?: boolean;
    }>;
  };
  logistics?: {
    missing?: Array<{
      costId?: string;
      supplierId?: string;
      supplierName?: string;
      documentType?: string;
      invoiceLabel?: string;
      requirementKey?: string;
      missingBucket?: string;
      costType?: string;
      label?: string;
      missingCost?: boolean;
    }>;
    requirements?: Array<{
      key?: string;
      label?: string;
      costTypes?: string[];
      completed?: boolean;
      costs?: Array<{
        costId?: string;
        supplierId?: string;
        supplierName?: string;
        costType?: string;
        costTypeRaw?: string;
      }>;
      invoiceGroups?: Array<{
        documentId?: string;
        logisticsExpenseId?: string;
        invoiceGroupId?: string;
        invoiceGroupLabel?: string;
        includedFeeTypes?: string[];
        feeTypes?: string[];
        costTypes?: string[];
        costIds?: string[];
      }>;
    }>;
  };
  calculation?: {
    completed?: number;
    total?: number;
    complete?: boolean;
    estimatedRefundAmount?: number;
    missing?: Array<{
      documentType?: string;
      label?: string;
    }>;
  };
};

export type TaxRefundRow = {
  id: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  billOfLadingNumbers?: string[];
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  businessEntityId?: string;
  businessEntityName?: string;
  businessEntityShortName?: string;
  businessEntityDisplayName?: string;
  businessEntityNameSnapshot?: string;
  currency?: string;
  customsDeclarationNo?: string;
  customsDeclarationDate?: string | null;
  customsParseStatusLabel?: string;
  customsParseSourceLabel?: string;
  customsParseMessage?: string;
  declarationDate?: string | null;
  taxRefundStatus?: string;
  taxRefundStatusLabel?: string;
  taxArchived?: boolean;
  taxRefundArchivedByName?: string;
  taxRefundArchivedAt?: string | null;
  taxRefundArchiveRemark?: string;
  taxSubmittedByName?: string;
  taxSubmittedAt?: string | null;
  documentCompleteness?: DocumentCompleteness;
  overallCompleteness?: number;
  completenessUpdatedAt?: string | null;
  completenessIssuesSummary?: string;
  refundStatus?: string;
};

export type CustomsDeclarationItem = {
  id?: string;
  documentId?: string;
  declarationNo?: string;
  declarationDate?: string | null;
  exportDate?: string | null;
  domesticConsignor?: string;
  declarationUnit?: string;
  transportMode?: string;
  billOfLadingNo?: string;
  tradeCountry?: string;
  destinationCountry?: string;
  supervisionMode?: string;
  hsCode?: string;
  productName?: string;
  specification?: string;
  quantity?: number | null;
  unit?: string;
  unitPrice?: number | null;
  totalAmount?: number | null;
  tradeTerm?: string;
  currency?: string;
  fobAmount?: number | null;
  grossWeight?: number | null;
  netWeight?: number | null;
  originCountry?: string;
  exchangeRate?: number | null;
  fobAmountCny?: number | null;
  confirmationStatus?: string;
  source?: string;
  sortOrder?: number;
};

export type ExportTaxRefundCalculation = {
  id?: string;
  declarationItemId?: string;
  declarationNo?: string;
  hsCode?: string;
  productName?: string;
  declarationDate?: string | null;
  fobCurrency?: string;
  fobAmount?: number | null;
  exchangeRate?: number | null;
  declarationAmountCny?: number | null;
  customsRmbAmount?: number | null;
  rebateRate?: number | null;
  vatRate?: number | null;
  theoreticalRefundAmount?: number | null;
  supplierInvoiceAmountWithTax?: number | null;
  supplierInvoiceAmountWithoutTax?: number | null;
  availableInputVatAmount?: number | null;
  inputVatAmount?: number | null;
  estimatedRefundAmount?: number | null;
  invoiceMatchStatus?: string;
  calculationStatus?: string;
  abnormalReasons?: string[];
  invoiceMatch?: {
    supplierCount?: number;
    invoiceCount?: number;
    invoiceQuantity?: number;
    invoiceAmountWithTax?: number;
    invoiceAmountWithoutTax?: number;
    supplierInvoiceAmountWithTax?: number;
    supplierInvoiceAmountWithoutTax?: number;
    differenceQuantity?: number;
    differenceAmount?: number;
    companyHs?: {
      id?: string;
      hsCode?: string;
      cnName?: string;
      unit?: string;
      rebateRate?: number;
      vatRate?: number;
    } | null;
    lines?: unknown[];
  };
};

export type ExportTaxRefundSummary = {
  estimatedRefundAmount?: number;
  calculationStatus?: string;
  abnormalReasons?: string[];
};

export type BusinessEntityOption = {
  id: string;
  name: string;
  shortName?: string;
  displayName?: string;
  isDefault?: boolean;
  status?: string;
};

export type TaxDocument = {
  id: string;
  fileId?: string;
  costId?: string;
  supplierId?: string;
  documentType?: string;
  documentTypeLabel?: string;
  relatedModule?: string;
  supplierName?: string;
  costType?: string;
  fileName?: string;
  fileSize?: number;
  uploadStatus?: string;
  uploadStatusLabel?: string;
  recognitionStatus?: string;
  uploadedBy?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  previewUrl?: string;
  downloadUrl?: string;
  customsRecognition?: CustomsRecognitionResult;
};

export type TaxCost = {
  id: string;
  supplierId?: string;
  supplierName?: string;
  supplierNameSnapshot?: string;
  vendorName?: string;
  supplierType?: string;
  costType?: string;
  amount?: number;
  amountCny?: number;
  currency?: string;
  documents?: TaxDocument[];
};

export type UploadScope = {
  costId?: string;
  supplierId?: string;
};

export type DomesticLogisticsInfo = {
  archiveStatusLabel?: string;
  remarkText?: string;
  exportInvoice?: { remark?: ExportInvoiceRemark | null };
  transportItems?: Array<{
    containerNo?: string;
    containerType?: string;
    truckPlateNo?: string;
    trailerPlateNo?: string;
    departureDate?: string;
    departurePlace?: string;
    arrivalPlace?: string;
    cargoName?: string;
  }>;
  submittedByName?: string;
  submittedAt?: string;
};

export type TaxRefundDetail = TaxRefundRow & {
  documents?: TaxDocument[];
  costs?: TaxCost[];
  domesticLogisticsInfo?: DomesticLogisticsInfo | null;
  customsDeclarationItems?: CustomsDeclarationItem[];
  customsOcrRawResult?: {
    id?: string;
    documentId?: string;
    orderId?: string;
    documentType?: string;
    provider?: string;
    apiName?: string;
    rawJson?: unknown;
    parsedJson?: unknown;
    confidence?: number | null;
    status?: string;
    errorMessage?: string;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
  exportTaxRefundCalculations?: ExportTaxRefundCalculation[];
  exportTaxRefundSummary?: ExportTaxRefundSummary;
};

export type TaxRefundDetailTab =
  | "basic"
  | "calculation"
  | "export-documents"
  | "customs-documents"
  | "factory-documents"
  | "logistics-documents";

export type CustomsRecognitionResult = {
  attempted?: boolean;
  documentId?: string;
  orderId?: string;
  documentType?: string;
  customsDeclarationNo?: string;
  customsDeclarationDate?: string;
  currentCustomsDeclarationNo?: string;
  currentCustomsDeclarationDate?: string;
  customsParseStatus?: string;
  customsParseStatusLabel?: string;
  customsParseMessage?: string;
  applied?: boolean;
  requiresConfirmation?: boolean;
  conflictFields?: string[];
  order?: TaxRefundDetail | null;
};

export type UploadDocumentResponse = {
  success?: boolean;
  message?: string;
  data?: TaxDocument;
  document?: TaxDocument;
  customsRecognition?: CustomsRecognitionResult;
};

export type CustomsRecognitionResponse = {
  success?: boolean;
  message?: string;
  data?: CustomsRecognitionResult;
  customsRecognition?: CustomsRecognitionResult;
  order?: TaxRefundDetail | null;
};

export type CustomsFilePickerState = {
  order: TaxRefundDetail;
  documents: TaxDocument[];
} | null;

export type TaxRefundResponse = {
  orders: TaxRefundRow[];
  pagination?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
  error?: string;
};

export type TaxRefundDetailResponse = {
  order: TaxRefundDetail;
};

export type ShippingDocumentDraftItem = {
  typeKey?: string;
  label?: string;
  emailLabel?: string;
  documentId?: string;
  fileName?: string;
  originalFilename?: string;
  exists?: boolean;
};

export type ManualShippingDraft = {
  customerShortName?: string;
  orderNo?: string;
  billOfLadingNo?: string;
  blNo?: string;
  customsDeclarationDate?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  language?: string;
  languageLabel?: string;
  subject?: string;
  body?: string;
  documents?: ShippingDocumentDraftItem[];
  missingLabels?: string[];
  attachmentCount?: number;
  canSendWithIncomplete?: boolean;
  incompleteMessage?: string;
};

export type ManualShippingForm = {
  recipientEmails: string;
  ccEmails: string;
  emailLanguage: string;
  emailSubject: string;
  emailBody: string;
};

export type SupplierOption = {
  id: string;
  supplierName?: string;
  supplierType?: string;
  email?: string;
  allowFactoryDocumentUpload?: boolean;
};

export type SupplierDocumentRequestForm = {
  order: TaxRefundDetail;
  suppliers: SupplierOption[];
  supplierId: string;
  requiredDocumentTypes: string[];
  dueDate: string;
  message: string;
  templateFile: File | null;
  loadingSuppliers: boolean;
  error: string;
};

export type TaxRefundMode = "current" | "archive";

export const PAGE_SIZE = 20;
export const TAX_EXPORT_UPLOAD_TYPES = [
  { value: "BILL_OF_LADING", label: "提单" },
  { value: "COMMERCIAL_INVOICE", label: "清关发票" },
  { value: "PACKING_LIST", label: "装箱单" },
  { value: "EXPORT_INVOICE", label: "出口发票" },
  { value: "SALES_CONTRACT", label: "销售合同" },
];
export const SALESPERSON_TAX_REFUND_UPLOAD_TYPES = new Set(["BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "SALES_CONTRACT"]);
export const TAX_CUSTOMS_UPLOAD_TYPES = [
  { value: "CUSTOMS_ENTRY_FORM", label: "报关单" },
  { value: "RELEASE_NOTICE", label: "放行通知书" },
  { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
];
export const TAX_FACTORY_UPLOAD_TYPES = [
  { value: "SUPPLIER_PURCHASE_CONTRACT", label: "工厂采购合同" },
  { value: "SUPPLIER_INVOICE", label: "工厂增值税发票" },
];
export const TAX_LOGISTICS_INVOICE_COST_TYPES = ["报关费", "拖车费", "国内物流费", "国内拖车费", "港杂费", "海运费"];
export const TAX_REFUND_STATUS_OPTIONS = [
  { value: "", label: "全部退税状态" },
  { value: "NO_CUSTOMS", label: "未上传报关单" },
  { value: "CUSTOMS_RECOGNIZED_PENDING_CONFIRM", label: "已识别待确认" },
  { value: "HS_NOT_MAINTAINED", label: "HS编码未维护" },
  { value: "REBATE_RATE_MATCHED", label: "HS退税率已匹配" },
  { value: "SUPPLIER_INVOICE_MATCHED", label: "供应商发票已匹配" },
  { value: "REFUND_CALCULATED", label: "退税金额已计算" },
  { value: "NOT_READY", label: "资料不完整" },
  { value: "READY", label: "资料完整待提交" },
  { value: "PROBLEM", label: "资料异常" },
  { value: "SUBMITTED", label: "已提交退税" },
  { value: "REFUND_RECEIVED", label: "已收到退税款" },
];
