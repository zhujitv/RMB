export type TransportItem = {
  id?: string;
  containerNo?: string;
  containerType?: string;
  sealNo?: string;
  truckPlateNo?: string;
  trailerPlateNo?: string;
  departureDate?: string;
  departurePlace?: string;
  arrivalPlace?: string;
  cargoName?: string;
  remark?: string;
};

export type DomesticLogisticsInfo = {
  id?: string;
  transportType?: string;
  transportTypeLabel?: string;
  truckPlateNo?: string;
  trailerPlateNo?: string;
  departurePlace?: string;
  destinationPlace?: string;
  departureDate?: string;
  expressTrackingNo?: string;
  cargoDescription?: string;
  transportItems?: TransportItem[];
  submittedByName?: string;
  submittedAt?: string;
  submitterRole?: string;
  archiveStatusLabel?: string;
};

export type DomesticLogisticsDocument = {
  id: string;
  documentType?: string;
  documentTypeLabel?: string;
  fileName?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  uploadStatus?: string;
};

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
  customsParseMessage?: string;
  applied?: boolean;
  requiresConfirmation?: boolean;
  conflictFields?: string[];
};

export type UploadedDocument = DomesticLogisticsDocument & {
  customsRecognition?: CustomsRecognitionResult | null;
};

export type DomesticCustomsDeclaration = {
  id: string;
  orderId?: string;
  billOfLadingNo?: string;
  batchNo?: string;
  declarationNo?: string;
  customsDeclarationNo?: string;
  declarationDate?: string | null;
  customsDeclarationDate?: string | null;
  declarationAmount?: number | null;
  customsDeclarationAmount?: number | null;
  containerCount?: number | null;
  customsDeclarationContainerCount?: number | null;
  pdfDocumentId?: string;
  pdfStatus?: string;
  pdfDocument?: DomesticLogisticsDocument | null;
  documents?: DomesticLogisticsDocument[];
  supplierName?: string;
  supplierCount?: number;
  supplierValidationStatus?: string;
  supplierCompleteness?: number | null;
  taxRefundStatus?: string;
  overallCompleteness?: number | null;
  taxArchived?: boolean;
  status?: string;
};

export type ShipsgoTimelineEvent = {
  time?: string;
  location?: string;
  description?: string;
  vesselName?: string;
  voyage?: string;
  source?: string;
};

export type ShipsgoTrackingRow = {
  id: string;
  orderId?: string;
  provider?: string;
  mode?: string;
  shipsgoShipmentId?: string;
  masterBlNo?: string;
  reference?: string;
  carrierScac?: string;
  carrierName?: string;
  bookingNumber?: string;
  containerNumber?: string;
  containerNumbers?: string[];
  status?: string;
  currentStatus?: string;
  statusLabel?: string;
  syncStatus?: string;
  syncMessage?: string;
  originName?: string;
  originPortName?: string;
  originPortCode?: string;
  destinationName?: string;
  destinationPortName?: string;
  destinationPortCode?: string;
  dateOfLoading?: string;
  dateOfDischarge?: string;
  predictedDischargeDate?: string;
  eta?: string;
  vesselName?: string;
  voyage?: string;
  mapUrl?: string;
  lastEvent?: string;
  lastEventAt?: string;
  lastCheckedAt?: string;
  lastSyncedAt?: string;
  lastSyncTime?: string;
  updatedAt?: string;
  timeline?: ShipsgoTimelineEvent[];
};

export type UploadDocumentResponse = {
  success?: boolean;
  message?: string;
  data?: UploadedDocument;
  document?: UploadedDocument;
};

export type CustomsRecognitionResponse = {
  success?: boolean;
  data?: CustomsRecognitionResult;
  customsRecognition?: CustomsRecognitionResult;
  message?: string;
};

export type DomesticLogisticsRow = {
  id: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  logisticsStatus?: string;
  isArchived?: boolean;
  auditStatus?: string;
  invoiceStatus?: string;
  archiveEligible?: boolean;
  logisticsExpenseStatus?: string;
  logisticsExpenseStatusLabel?: string;
  logisticsExpenseBillId?: string;
  logisticsExpenseCount?: number;
  submittedAt?: string | null;
  domesticLogisticsInfo?: DomesticLogisticsInfo | null;
  documents?: DomesticLogisticsDocument[];
  customsDeclarations?: DomesticCustomsDeclaration[];
  logisticsSuppliers?: Array<{ id: string; supplierName?: string; name?: string; supplierType?: string }>;
  shipsgoTrackings?: ShipsgoTrackingRow[];
};

export type ShipsgoFeatureFlags = {
  enabled?: boolean;
  oceanTrackingEnabled?: boolean;
  airTrackingEnabled?: boolean;
  manualSyncEnabled?: boolean;
  autoSyncEnabled?: boolean;
  dailySyncTime?: string;
  webhookEnabled?: boolean;
  liveMapEnabled?: boolean;
  customerPushEnabled?: boolean;
  creditWarningThreshold?: number;
};

export type DomesticLogisticsResponse = {
  rows: DomesticLogisticsRow[];
  error?: string;
  shipsgo?: ShipsgoFeatureFlags;
};

export type ShipsgoControlTowerStats = {
  inTransitCount: number;
  soonArrivingCount: number;
  etaOverdueCount: number;
  syncFailedCount: number;
  syncedTodayCount: number;
};

export type ShipsgoControlTowerRow = ShipsgoTrackingRow & {
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  orderIsArchived?: boolean;
  isCompleted?: boolean;
  isSoonArriving?: boolean;
  isEtaOverdue?: boolean;
  isSyncStale?: boolean;
  isSyncFailed?: boolean;
  alertLabels?: string[];
  latestNodeTime?: string;
  latestNodeLocation?: string;
  latestNodeDescription?: string;
  containerCount?: number;
};

export type ShipsgoControlTowerResponse = {
  success?: boolean;
  rows?: ShipsgoControlTowerRow[];
  stats?: ShipsgoControlTowerStats;
  updatedAt?: string;
  message?: string;
};

export type ShipsgoControlTowerFilters = {
  customer: string;
  orderNo: string;
  masterBlNo: string;
  carrier: string;
  origin: string;
  destination: string;
  status: string;
  etaStart: string;
  etaEnd: string;
  overdue: string;
  syncFailed: string;
  includeCompleted: boolean;
};

export type DomesticLogisticsForm = {
  orderId: string;
  transportType: string;
  expressTrackingNo: string;
  destinationPlace: string;
  cargoDescription: string;
  remarkText: string;
  remarkTextManualEdited: boolean;
  transportItems: TransportItem[];
};

export type StructuredTransportRemark = {
  containers: Array<{
    containerNo: string;
    type: string;
    truckNo: string;
    trailerNo: string;
    shipDate: string;
    origin: string;
    destination: string;
    goods: string;
  }>;
};

const ALLOWED_LOGISTICS_INFO_KEYS = [
  "id",
  "transportType",
  "transportTypeLabel",
  "truckPlateNo",
  "trailerPlateNo",
  "departurePlace",
  "destinationPlace",
  "departureDate",
  "expressTrackingNo",
  "cargoDescription",
  "transportItems",
  "submittedByName",
  "submittedAt",
  "submitterRole",
  "archiveStatusLabel",
] satisfies Array<keyof DomesticLogisticsInfo>;

const ALLOWED_LOGISTICS_ROW_KEYS = [
  "id",
  "orderId",
  "orderNo",
  "blNo",
  "billOfLadingNo",
  "customerName",
  "customerFullName",
  "customerShortName",
  "logisticsStatus",
  "isArchived",
  "auditStatus",
  "invoiceStatus",
  "archiveEligible",
  "logisticsExpenseStatus",
  "logisticsExpenseStatusLabel",
  "logisticsExpenseBillId",
  "logisticsExpenseCount",
  "submittedAt",
  "documents",
  "customsDeclarations",
  "logisticsSuppliers",
  "shipsgoTrackings",
] satisfies Array<keyof DomesticLogisticsRow>;

export const ALLOWED_LOGISTICS_FIELDS = ALLOWED_LOGISTICS_ROW_KEYS;

export const PAGE_SIZE = 20;
export const TRANSPORT_TYPES = [
  { value: "TRUCK", label: "车辆运输" },
  { value: "EXPRESS", label: "快递运输" },
  { value: "MULTIMODAL", label: "多式联运" },
  { value: "BULK_WAREHOUSE", label: "散货进舱" },
];
export const CUSTOMS_DOCUMENT_TYPES = [
  { value: "CUSTOMS_ENTRY_FORM", label: "报关单" },
  { value: "RELEASE_NOTICE", label: "放行通知书" },
  { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
  { value: "PACKING_LIST", label: "装箱单" },
  { value: "COMMERCIAL_INVOICE", label: "商业发票" },
  { value: "SALES_CONTRACT", label: "销售合同" },
];
export const ARCHIVE_SCOPE_OPTIONS = [
  { value: "current", label: "当前业务" },
  { value: "archive", label: "已归档业务" },
];
export const ARCHIVE_BUTTON_DISABLED_TOOLTIP = "仅允许批量归档审核通过且已上传发票的订单";
export const PAYLOAD_ARCHIVE_ENDPOINT = "/api/domestic-logistics/archive";
export const ARCHIVE_BUTTON_RULE = {
  allow: ["审核通过 + 已上传发票 + 未归档"],
  deny: ["草稿", "待审核", "已驳回", "未上传发票", "已归档"],
} as const;
export const CONTAINER_TYPE_OPTIONS = ["20GP", "40GP", "40HQ", "45HQ"];
export const EMPTY_SHIPSGO_CONTROL_TOWER_STATS: ShipsgoControlTowerStats = {
  inTransitCount: 0,
  soonArrivingCount: 0,
  etaOverdueCount: 0,
  syncFailedCount: 0,
  syncedTodayCount: 0,
};
export const EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS: ShipsgoControlTowerFilters = {
  customer: "",
  orderNo: "",
  masterBlNo: "",
  carrier: "",
  origin: "",
  destination: "",
  status: "",
  etaStart: "",
  etaEnd: "",
  overdue: "",
  syncFailed: "",
  includeCompleted: false,
};

export function emptyTransportItem(): TransportItem {
  return {
    containerNo: "",
    containerType: "",
    sealNo: "",
    truckPlateNo: "",
    trailerPlateNo: "",
    departureDate: "",
    departurePlace: "",
    arrivalPlace: "",
    cargoName: "",
    remark: "",
  };
}

function sanitizeDomesticLogisticsInfoForRender(info?: DomesticLogisticsInfo | null): DomesticLogisticsInfo | null {
  if (!info) return null;
  const allowedInfo: Partial<DomesticLogisticsInfo> = {};
  for (const key of ALLOWED_LOGISTICS_INFO_KEYS) {
    if (info[key] !== undefined) allowedInfo[key] = info[key] as never;
  }
  return allowedInfo;
}

export function sanitizeDomesticLogisticsRowsForRender(rows: DomesticLogisticsRow[] = []) {
  return rows.map((row) => {
    const allowedRow: Partial<DomesticLogisticsRow> = {};
    for (const key of ALLOWED_LOGISTICS_ROW_KEYS) {
      if (row[key] !== undefined) allowedRow[key] = row[key] as never;
    }
    return {
      ...allowedRow,
      id: row.id,
      domesticLogisticsInfo: sanitizeDomesticLogisticsInfoForRender(row.domesticLogisticsInfo),
    };
  });
}

export function domesticLogisticsCanArchive(row: DomesticLogisticsRow) {
  return row.archiveEligible === true && row.isArchived !== true;
}
