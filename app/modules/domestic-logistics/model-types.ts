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

export type ShipsgoTimelineEvent = {
  time?: string;
  location?: string;
  description?: string;
  vesselName?: string;
  voyage?: string;
  eventCode?: string;
  eventCategory?: string;
  isWarning?: boolean;
  isDumpingWarning?: boolean;
  source?: string;
};

export type FreightowerTrackingAlert = {
  code?: string;
  category?: string;
  title?: string;
  description?: string;
  time?: string;
  location?: string;
  containerNo?: string;
  severity?: "critical" | "warning";
  isDumping?: boolean;
  active?: boolean;
  source?: "warning" | "status";
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
  portTrackingStatus?: string;
  portTrackingMessage?: string;
  portCode?: string;
  portDirection?: string;
  portLastCheckedAt?: string;
  portLastSyncedAt?: string;
  portEventCount?: number;
  alerts?: FreightowerTrackingAlert[];
  alertCount?: number;
  hasDumpingWarning?: boolean;
  dumpingWarning?: string;
  dumpingWarningAt?: string;
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
  tradeTerm?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  businessEntityIsDefault?: boolean;
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
  logisticsSuppliers?: Array<{ id: string; supplierName?: string; name?: string; supplierType?: string }>;
  shipsgoTrackings?: ShipsgoTrackingRow[];
};

export type ShipsgoFeatureFlags = {
  enabled?: boolean;
  activeProvider?: string;
  providerLabel?: string;
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
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  error?: string;
  shipsgo?: ShipsgoFeatureFlags;
};

export type ShipsgoControlTowerStats = {
  inTransitCount: number;
  dumpingWarningCount: number;
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
  businessEntityIsDefault?: boolean;
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
