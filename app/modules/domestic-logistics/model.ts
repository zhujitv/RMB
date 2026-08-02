import type {
  DomesticLogisticsInfo,
  DomesticLogisticsRow,
  ShipsgoControlTowerFilters,
  ShipsgoControlTowerStats,
  TransportItem,
} from "./model-types.ts";

export * from "./model-types.ts";

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
  "tradeTerm",
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

export function isExwTradeTerm(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase().includes("EXW");
}
export const EMPTY_SHIPSGO_CONTROL_TOWER_STATS: ShipsgoControlTowerStats = {
  inTransitCount: 0,
  dumpingWarningCount: 0,
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
