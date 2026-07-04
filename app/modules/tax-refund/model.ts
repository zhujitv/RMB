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
};

export type TaxRefundRow = {
  id: string;
  orderId?: string;
  customsDeclarationId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  billOfLadingNumbers?: string[];
  declarationNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  supplierId?: string;
  supplierName?: string;
  supplierOwnershipStatus?: string;
  purchaseOrderId?: string;
  businessEntityId?: string;
  businessEntityName?: string;
  businessEntityShortName?: string;
  businessEntityDisplayName?: string;
  businessEntityNameSnapshot?: string;
  currency?: string;
  customsDeclarationNo?: string;
  customsDeclarationDate?: string | null;
  declarationDate?: string | null;
  customsDeclarationAmount?: number | null;
  declarationAmount?: number | null;
  customsDeclarationContainerCount?: number | null;
  containerCount?: number | null;
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
  uploadedBy?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  previewUrl?: string;
  downloadUrl?: string;
  customsPdfTextParse?: {
    customsDeclarationNo?: string;
    customsDeclarationDate?: string;
  };
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
  batchOwnershipStatus?: string;
  batchOwnershipNote?: string;
  documents?: TaxDocument[];
};

export type UploadScope = {
  costId?: string;
  supplierId?: string;
  customsDeclarationId?: string;
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
};

export type TaxRefundDetailTab =
  | "basic"
  | "export-documents"
  | "customs-documents"
  | "factory-documents"
  | "logistics-documents";

export type UploadDocumentResponse = {
  success?: boolean;
  message?: string;
  data?: TaxDocument;
  document?: TaxDocument;
};

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
export const TAX_LOGISTICS_INVOICE_COST_TYPES = [
  "报关费",
  "拖车费",
  "国内物流费",
  "国内拖车费",
  "打单费",
  "进港费",
  "提箱费",
  "落箱费",
  "预提费",
  "查验费",
  "超重费",
  "其他本地费用",
  "其他物流费用",
  "港杂费",
  "文件费",
  "订舱费",
  "海运费",
  "其他国际费用",
];
export const TAX_REFUND_STATUS_OPTIONS = [
  { value: "", label: "全部退税状态" },
  { value: "NOT_READY", label: "资料不完整" },
  { value: "READY", label: "资料完整待提交" },
  { value: "PROBLEM", label: "资料异常" },
  { value: "SUBMITTED", label: "已提交退税" },
  { value: "REFUND_RECEIVED", label: "已收到退税款" },
];
