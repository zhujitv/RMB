"use client";

import type { FormEvent } from "react";
import { Fragment } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, PaginationBar, PdfPreviewButton, UiCheckbox, useConfirmationDialog } from "../components";
import { preventEnterFormSubmit } from "../formGuards";
import { formatDate, formatDateTime } from "../formatters";
import { LogisticsExpenseForm, LogisticsFeesModule } from "./LogisticsFeesModule";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import { UPLOAD_REPLACE_TEXT } from "../uploadTexts";
import { canWritePermission, customerDisplayName, customerLegalName, PDF_UPLOAD_ACCEPT, uploadFormDataWithProgress, validatePdfUploadFile } from "../utils";
import {
  formatShipsgoCarrierForLocale,
  formatShipsgoPortForLocale,
  formatShipsgoStatusForLocale,
  formatShipsgoTrackingMethodForLocale,
} from "../../lib/shipsgo-display";

type TransportItem = {
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

type DomesticLogisticsInfo = {
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

type DomesticLogisticsDocument = {
  id: string;
  documentType?: string;
  documentTypeLabel?: string;
  fileName?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  uploadStatus?: string;
};

type CustomsRecognitionResult = {
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

type UploadedDocument = DomesticLogisticsDocument & {
  customsRecognition?: CustomsRecognitionResult | null;
};

type ShipsgoTrackingRow = {
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

type ShipsgoTimelineEvent = {
  time?: string;
  location?: string;
  description?: string;
  vesselName?: string;
  voyage?: string;
  source?: string;
};

type UploadDocumentResponse = {
  success?: boolean;
  message?: string;
  data?: UploadedDocument;
  document?: UploadedDocument;
};

type CustomsRecognitionResponse = {
  success?: boolean;
  data?: CustomsRecognitionResult;
  customsRecognition?: CustomsRecognitionResult;
  message?: string;
};

type DomesticLogisticsRow = {
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
  logisticsSuppliers?: Array<{ id: string; supplierName?: string; name?: string; supplierType?: string }>;
  shipsgoTrackings?: ShipsgoTrackingRow[];
};

type ShipsgoFeatureFlags = {
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

type DomesticLogisticsResponse = {
  rows: DomesticLogisticsRow[];
  error?: string;
  shipsgo?: ShipsgoFeatureFlags;
};

type ShipsgoControlTowerStats = {
  inTransitCount: number;
  soonArrivingCount: number;
  etaOverdueCount: number;
  syncFailedCount: number;
  syncedTodayCount: number;
};

type ShipsgoControlTowerRow = ShipsgoTrackingRow & {
  orderNo?: string;
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

type ShipsgoControlTowerResponse = {
  success?: boolean;
  rows?: ShipsgoControlTowerRow[];
  stats?: ShipsgoControlTowerStats;
  updatedAt?: string;
  message?: string;
};

type ShipsgoControlTowerFilters = {
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

type DomesticLogisticsForm = {
  orderId: string;
  transportType: string;
  expressTrackingNo: string;
  destinationPlace: string;
  cargoDescription: string;
  remarkText: string;
  remarkTextManualEdited: boolean;
  transportItems: TransportItem[];
};
type StructuredTransportRemark = {
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

const ALLOWED_LOGISTICS_FIELDS = [
  "orderNo",
  "customer",
  "route",
  "container",
  "status",
  "costStatus",
] as const;
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
  "logisticsSuppliers",
  "shipsgoTrackings",
] satisfies Array<keyof DomesticLogisticsRow>;

const PAGE_SIZE = 20;
const TRANSPORT_TYPES = [
  { value: "TRUCK", label: "车辆运输" },
  { value: "EXPRESS", label: "快递运输" },
  { value: "MULTIMODAL", label: "多式联运" },
  { value: "BULK_WAREHOUSE", label: "散货进舱" },
];
const CUSTOMS_DOCUMENT_TYPES = [
  { value: "CUSTOMS_ENTRY_FORM", label: "报关单" },
  { value: "RELEASE_NOTICE", label: "放行通知书" },
  { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
];
const ARCHIVE_SCOPE_OPTIONS = [
  { value: "current", label: "当前业务" },
  { value: "archive", label: "已归档业务" },
];
const ARCHIVE_BUTTON_DISABLED_TOOLTIP = "仅允许批量归档审核通过且已上传发票的订单";
const PAYLOAD_ARCHIVE_ENDPOINT = "/api/domestic-logistics/archive";
const ARCHIVE_BUTTON_RULE = {
  allow: ["审核通过 + 已上传发票 + 未归档"],
  deny: ["草稿", "待审核", "已驳回", "未上传发票", "已归档"],
} as const;
const CONTAINER_TYPE_OPTIONS = ["20GP", "40GP", "40HQ", "45HQ"];
const EMPTY_SHIPSGO_CONTROL_TOWER_STATS: ShipsgoControlTowerStats = {
  inTransitCount: 0,
  soonArrivingCount: 0,
  etaOverdueCount: 0,
  syncFailedCount: 0,
  syncedTodayCount: 0,
};
const EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS: ShipsgoControlTowerFilters = {
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

function emptyTransportItem(): TransportItem {
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

function customsRecognitionNotice(result?: CustomsRecognitionResult | null) {
  const status = result?.customsParseStatus || "";
  const declarationNo = result?.customsDeclarationNo || "";
  const declarationDate = result?.customsDeclarationDate || "";
  if (status === "SUCCESS" && declarationNo && declarationDate) {
    return `已识别报关单号：${declarationNo}；已识别申报日期：${declarationDate}`;
  }
  if (declarationNo || declarationDate) {
    return [
      declarationNo ? `已识别报关单号：${declarationNo}` : "",
      declarationDate ? `已识别申报日期：${declarationDate}` : "",
    ].filter(Boolean).join("；");
  }
  return "未识别成功，请手工填写报关单号和申报日期";
}

function sanitizeDomesticLogisticsInfoForRender(info?: DomesticLogisticsInfo | null): DomesticLogisticsInfo | null {
  if (!info) return null;
  const allowedInfo: Partial<DomesticLogisticsInfo> = {};
  for (const key of ALLOWED_LOGISTICS_INFO_KEYS) {
    if (info[key] !== undefined) allowedInfo[key] = info[key] as never;
  }
  return allowedInfo;
}

function sanitizeDomesticLogisticsRowsForRender(rows: DomesticLogisticsRow[] = []) {
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

function domesticLogisticsCanArchive(row: DomesticLogisticsRow) {
  return row.archiveEligible === true && row.isArchived !== true;
}

export function DomesticLogisticsModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOpenToken = 0,
  focusFeesToken = 0,
  initialView = "list",
  initialControlTowerFullscreen = false,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOpenToken?: number;
  focusFeesToken?: number;
  initialView?: "list" | "controlTower";
  initialControlTowerFullscreen?: boolean;
}) {
  const [rows, setRows] = useState<DomesticLogisticsRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [businessScope, setBusinessScope] = useState("current");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shipsgoFeatures, setShipsgoFeatures] = useState<ShipsgoFeatureFlags>({ enabled: false });
  const [activeLogisticsView, setActiveLogisticsView] = useState<"list" | "controlTower">(initialView);
  const [editingOrderId, setEditingOrderId] = useState("");
  const [feeEntryOrderId, setFeeEntryOrderId] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [expenseRefreshToken, setExpenseRefreshToken] = useState(0);
  const [expenseFocus, setExpenseFocus] = useState({ token: 0, billId: "", keyword: "" });
  const [uploadingKey, setUploadingKey] = useState("");
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [shipsgoBusyKey, setShipsgoBusyKey] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canDeleteDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员"]);
  const canArchiveDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员"]);
  const canEditDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员", "物流供应商", "物流资料录入员"]);
  const canUploadCustomsDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "业务员", "物流供应商", "物流资料录入员"])
    && canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员", "物流供应商", "物流资料录入员"]);
  const canDeleteCustomsDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员"]);
  const canCreateLogisticsExpense = canWritePermission(currentUser, permissions, "logistics", ["管理员", "物流供应商"]);
  const canViewShipsgoControlTower = !currentUser.supplierId && currentUser.role !== "物流供应商";

  async function loadRows(nextKeyword = submittedKeyword, nextBusinessScope = businessScope) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ businessScope: nextBusinessScope });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<DomesticLogisticsResponse>(`/api/domestic-logistics?${params}`);
      const nextRows = sanitizeDomesticLogisticsRowsForRender(Array.isArray(result.rows) ? result.rows : []);
      setRows(nextRows);
      setShipsgoFeatures(result.shipsgo || { enabled: false });
      setSelectedOrderIds((current) => current.filter((orderId) => nextRows.some((row) => row.id === orderId)));
      if (result.error) setError(result.error || "读取资料失败");
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取物流信息失败");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const value = initialKeyword.trim();
    if (value) return;
    void loadRows("");
  }, []);

  useEffect(() => {
    setActiveLogisticsView(initialView);
  }, [initialView]);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setFeeEntryOrderId("");
    setNotice("");
    void loadRows(value, businessScope).then((nextRows) => {
      const matched = nextRows.find((row) => (
        row.orderNo === value
        || row.blNo === value
        || row.billOfLadingNo === value
        || row.id === value
        || row.orderId === value
      )) || nextRows[0];
      if (!matched) return;
      setExpandedId(matched.id);
      if (canEditDomesticLogistics) setEditingOrderId(matched.id);
    });
  }, [initialOpenToken]);

  useEffect(() => {
    if (!focusFeesToken) return;
    window.setTimeout(() => {
      document.getElementById("domestic-logistics-fees")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, [focusFeesToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setPage(1);
      setExpandedId("");
      setEditingOrderId("");
      setFeeEntryOrderId("");
      setNotice("");
      void loadRows(value, businessScope);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, businessScope]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedOrderIds.includes(row.id)), [rows, selectedOrderIds]);
  const selectedArchivableRows = useMemo(() => selectedRows.filter(domesticLogisticsCanArchive), [selectedRows]);
  const pageArchivableRows = useMemo(() => pageRows.filter(domesticLogisticsCanArchive), [pageRows]);
  const allPageArchivableSelected = pageArchivableRows.length > 0
    && pageArchivableRows.every((row) => selectedOrderIds.includes(row.id));
  const tableColSpan = canArchiveDomesticLogistics ? 8 : 7;

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setFeeEntryOrderId("");
    setSelectedOrderIds([]);
    setNotice("");
    void loadRows(value, businessScope);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setBusinessScope("current");
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setFeeEntryOrderId("");
    setSelectedOrderIds([]);
    setNotice("");
    void loadRows("", "current");
  }

  function changeBusinessScope(nextBusinessScope: string) {
    setBusinessScope(nextBusinessScope);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setFeeEntryOrderId("");
    setSelectedOrderIds([]);
    setNotice("");
    void loadRows(submittedKeyword, nextBusinessScope);
  }

  function openLogisticsExpenseStatus(row: DomesticLogisticsRow) {
    const status = row.logisticsExpenseStatus || "未录入";
    setExpandedId(row.id);
    setEditingOrderId("");
    if (status === "未录入" || !row.logisticsExpenseBillId) {
      setFeeEntryOrderId(row.id);
      setNotice("该订单暂未创建物流费用账单，可在此录入费用。");
      return;
    }
    setFeeEntryOrderId("");
    setNotice("已定位到对应物流费用账单。");
    setExpenseFocus((current) => ({
      token: current.token + 1,
      billId: row.logisticsExpenseBillId || "",
      keyword: row.blNo || row.billOfLadingNo || row.orderNo || "",
    }));
    window.setTimeout(() => {
      document.getElementById("domestic-logistics-fees")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function toggleOrderSelection(row: DomesticLogisticsRow, checked: boolean) {
    if (!domesticLogisticsCanArchive(row)) return;
    setSelectedOrderIds((current) => {
      if (checked) return Array.from(new Set([...current, row.id]));
      return current.filter((orderId) => orderId !== row.id);
    });
  }

  function togglePageArchivableOrders(checked: boolean) {
    const pageArchivableIds = pageArchivableRows.map((row) => row.id);
    setSelectedOrderIds((current) => {
      if (checked) return Array.from(new Set([...current, ...pageArchivableIds]));
      return current.filter((orderId) => !pageArchivableIds.includes(orderId));
    });
  }

  async function archiveSelectedOrders() {
    if (!selectedArchivableRows.length) {
      setError(ARCHIVE_BUTTON_DISABLED_TOOLTIP);
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "确认批量归档？",
      message: "归档只改变物流信息列表展示，不会修改审核、发票、付款、成本或利润数据。",
      details: [
        `可归档订单：${selectedArchivableRows.length} 个（审核通过且已上传发票）`,
        selectedRows.length > selectedArchivableRows.length
          ? `已自动跳过不符合条件订单：${selectedRows.length - selectedArchivableRows.length} 个`
          : "",
      ].filter(Boolean),
      confirmLabel: "批量归档",
      cancelLabel: "取消",
    });
    if (!confirmationResult.confirmed) return;
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        archivedCount?: number;
        archivedIds?: string[];
        skippedIds?: string[];
      }>(PAYLOAD_ARCHIVE_ENDPOINT, {
        method: "PATCH",
        body: JSON.stringify({ orderIds: selectedOrderIds }),
      });
      if (result.success !== true) throw new Error(result.message || "批量归档失败");
      setSelectedOrderIds([]);
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || `已归档 ${result.archivedCount || 0} 个订单`);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "批量归档失败");
    }
  }

  async function uploadDocument(orderId: string, documentType: string, file: File | null) {
    if (!file) return;
    const isCustomsDeclaration = documentType === "CUSTOMS_ENTRY_FORM";
    const uploadKey = `${orderId}:${documentType}`;
    setUploadingKey(uploadKey);
    setUploadProgressByKey((current) => ({ ...current, [uploadKey]: 0 }));
    setError("");
    setNotice(isCustomsDeclaration ? "正在识别报关单信息..." : "");
    try {
      const validationError = validatePdfUploadFile(file);
      if (validationError) throw new Error(validationError);
      const formData = new FormData();
      formData.append("orderId", orderId);
      formData.append("documentType", documentType);
      formData.append("uploadSource", "REACT_DOMESTIC_LOGISTICS");
      formData.append("file", file);
      const data = await uploadFormDataWithProgress<UploadDocumentResponse>("/api/order-documents", formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [uploadKey]: progress }));
      });
      const uploadedDocument = data.document || data.data;
      const recognition = uploadedDocument?.customsRecognition || null;
      if (isCustomsDeclaration) {
        setNotice(customsRecognitionNotice(recognition));
      } else {
        setNotice("报关资料已上传");
      }
      await loadRows(submittedKeyword, businessScope);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[uploadKey];
        return next;
      });
    }
  }

  async function deleteDocument(document: DomesticLogisticsDocument) {
    const confirmationResult = await requestConfirmation({
      title: "确定删除该文件？",
      message: "删除后需要重新上传。",
      details: [`文件：${document.fileName || document.documentTypeLabel || "-"}`],
      confirmLabel: "删除文件",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingDocumentId(document.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/order-documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除失败，请重试");
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || "已删除文件");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败，请重试");
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function deleteDomesticLogistics(row: DomesticLogisticsRow) {
    const id = row.domesticLogisticsInfo?.id;
    if (!id) return;
    const confirmationResult = await requestConfirmation({
      title: "确认删除该物流信息？",
      message: "删除后该订单将恢复为未提交物流信息状态。",
      details: [`订单：${row.orderNo || "-"}`],
      confirmLabel: "删除物流信息",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/domestic-logistics/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除物流信息失败");
      setExpandedId("");
      setEditingOrderId("");
      setFeeEntryOrderId("");
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || "物流信息已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除物流信息失败");
    }
  }

  function updateRowShipsgoTracking(orderId: string, tracking: ShipsgoTrackingRow) {
    setRows((currentRows) => currentRows.map((row) => {
      if (row.id !== orderId && row.orderId !== orderId) return row;
      const currentTrackings = row.shipsgoTrackings || [];
      const nextTrackings = [
        tracking,
        ...currentTrackings.filter((item) => item.id !== tracking.id),
      ];
      return { ...row, shipsgoTrackings: nextTrackings };
    }));
  }

  async function createShipsgoTracking(row: DomesticLogisticsRow, payload: { masterBlNo: string; carrierScac?: string }) {
    const busyKey = `${row.id}:shipsgo:create`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>("/api/shipsgo/ocean-trackings", {
        method: "POST",
        body: JSON.stringify({
          orderId: row.id,
          masterBlNo: payload.masterBlNo,
          carrierScac: payload.carrierScac || "",
        }),
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "创建大掌櫃跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "大掌櫃跟踪已创建");
    } catch (createError) {
      throw createError instanceof Error ? createError : new Error("创建大掌櫃跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function syncShipsgoTracking(row: DomesticLogisticsRow, trackingId: string) {
    const busyKey = `${trackingId}:shipsgo:sync`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>(`/api/shipsgo/ocean-trackings/${encodeURIComponent(trackingId)}/sync`, {
        method: "POST",
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "同步大掌櫃跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "大掌櫃状态已同步");
      return result.tracking;
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "同步大掌櫃跟踪失败";
      setError(message);
      throw new Error(message);
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function recoverShipsgoTracking(row: DomesticLogisticsRow) {
    const busyKey = `${row.id}:shipsgo:recover`;
    setShipsgoBusyKey(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; tracking?: ShipsgoTrackingRow; message?: string }>("/api/shipsgo/ocean-trackings/recover", {
        method: "POST",
        body: JSON.stringify({
          orderId: row.id,
          masterBlNo: row.blNo || row.billOfLadingNo || "",
        }),
      });
      if (result.success !== true || !result.tracking) throw new Error(result.message || "从大掌櫃同步已有跟踪失败");
      updateRowShipsgoTracking(row.id, result.tracking);
      setNotice(result.message || "已从大掌櫃同步已有跟踪");
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : "从大掌櫃同步已有跟踪失败");
    } finally {
      setShipsgoBusyKey("");
    }
  }

  async function openControlTowerOrder(row: ShipsgoControlTowerRow) {
    const value = row.orderNo || row.masterBlNo || row.bookingNumber || "";
    setActiveLogisticsView("list");
    setBusinessScope(row.orderIsArchived ? "archive" : "current");
    setKeyword(value);
    setSubmittedKeyword(value);
    setPage(1);
    setNotice("");
    const nextRows = await loadRows(value, row.orderIsArchived ? "archive" : "current");
    const matched = nextRows.find((item) => (
      item.orderId === row.orderId
      || item.id === row.orderId
      || item.orderNo === row.orderNo
      || item.blNo === row.masterBlNo
      || item.billOfLadingNo === row.masterBlNo
    )) || nextRows[0];
    if (matched) setExpandedId(matched.id);
  }

  return (
    <>
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>物流信息</h2>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => {
            setNotice("");
            void loadRows();
          }}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className={styles.moduleViewTabs} role="tablist" aria-label="物流信息视图">
        <button
          className={activeLogisticsView === "list" ? styles.moduleViewTabActive : styles.moduleViewTab}
          type="button"
          role="tab"
          aria-selected={activeLogisticsView === "list"}
          onClick={() => setActiveLogisticsView("list")}
        >
          物流列表
        </button>
        {canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
          <button
            className={activeLogisticsView === "controlTower" ? styles.moduleViewTabActive : styles.moduleViewTab}
            type="button"
            role="tab"
            aria-selected={activeLogisticsView === "controlTower"}
            onClick={() => setActiveLogisticsView("controlTower")}
          >
            运输监控
          </button>
        ) : null}
      </div>

      {activeLogisticsView === "controlTower" && canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
        <ShipsgoControlTowerView
          features={shipsgoFeatures}
          canManage={canEditDomesticLogistics}
          initialFullScreen={initialControlTowerFullscreen}
          onOpenOrder={openControlTowerOrder}
        />
      ) : (
        <>
      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 柜号 / 物流供应商"
        />
        <select value={businessScope} onChange={(event) => changeBusinessScope(event.target.value)} disabled={loading}>
          {ARCHIVE_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
        {canArchiveDomesticLogistics ? (
          <button
            className={styles.primaryButtonCompact}
            type="button"
            disabled={loading || !selectedArchivableRows.length}
            title={selectedArchivableRows.length ? `批量归档 ${selectedArchivableRows.length} 个审核通过且已上传发票订单` : ARCHIVE_BUTTON_DISABLED_TOOLTIP}
            onClick={archiveSelectedOrders}
            data-rule={ARCHIVE_BUTTON_RULE.allow.join(",")}
          >
            批量归档{selectedArchivableRows.length ? `（${selectedArchivableRows.length}）` : ""}
          </button>
        ) : null}
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              {canArchiveDomesticLogistics ? (
                <th className={styles.selectionColumn}>
                  <UiCheckbox
                    variant="table"
                    label="选择本页可归档订单"
                    checked={allPageArchivableSelected}
                    disabled={!pageArchivableRows.length}
                    title={pageArchivableRows.length ? "选择本页审核通过且已上传发票订单" : ARCHIVE_BUTTON_DISABLED_TOOLTIP}
                    onChange={(event) => togglePageArchivableOrders(event.target.checked)}
                  />
                </th>
              ) : null}
              <th>订单号</th>
              <th>客户简称</th>
              <th>到达地</th>
              <th>运输货物名称</th>
              <th>物流状态</th>
              <th>费用录入状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={tableColSpan}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : pageRows.length ? pageRows.map((row) => (
              <DomesticLogisticsRows
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId((current) => {
                  const next = current === row.id ? "" : row.id;
                  if (!next) {
                    setEditingOrderId("");
                    setFeeEntryOrderId("");
                  }
                  return next;
                })}
                editing={editingOrderId === row.id}
                feeEntryOpen={feeEntryOrderId === row.id}
                canEditDomesticLogistics={canEditDomesticLogistics}
                canUploadCustomsDocuments={canUploadCustomsDocuments}
                canDeleteCustomsDocuments={canDeleteCustomsDocuments}
                onEdit={() => {
                  setExpandedId(row.id);
                  setFeeEntryOrderId("");
                  setEditingOrderId((current) => current === row.id ? "" : row.id);
                }}
                canCreateLogisticsExpense={canCreateLogisticsExpense}
                currentUserRole={currentUser.role}
                currentUserSupplierId={currentUser.supplierId || ""}
                onOpenExpenseStatus={() => openLogisticsExpenseStatus(row)}
                onOpenFeeEntry={() => {
                  setExpandedId(row.id);
                  setEditingOrderId("");
                  setFeeEntryOrderId((current) => current === row.id ? "" : row.id);
                }}
                onCloseFeeEntry={() => setFeeEntryOrderId("")}
                shipsgoFeatures={shipsgoFeatures}
                shipsgoBusyKey={shipsgoBusyKey}
                canManageShipsgoTracking={canEditDomesticLogistics}
                onCreateShipsgoTracking={(payload) => createShipsgoTracking(row, payload)}
                onSyncShipsgoTracking={(trackingId) => syncShipsgoTracking(row, trackingId)}
                onRecoverShipsgoTracking={() => recoverShipsgoTracking(row)}
                onSaved={() => {
                  setNotice(feeEntryOrderId === row.id ? "物流费用已提交" : "物流信息已保存");
                  setEditingOrderId("");
                  setFeeEntryOrderId("");
                  setExpenseRefreshToken((current) => current + 1);
                  void loadRows(submittedKeyword, businessScope);
                }}
                onCancelEdit={() => setEditingOrderId("")}
                canDeleteDomesticLogistics={canDeleteDomesticLogistics}
                onDeleteDomesticLogistics={() => void deleteDomesticLogistics(row)}
                uploadingKey={uploadingKey}
                uploadProgressByKey={uploadProgressByKey}
                deletingDocumentId={deletingDocumentId}
                onUploadDocument={uploadDocument}
                onDeleteDocument={deleteDocument}
                selectionEnabled={canArchiveDomesticLogistics}
                selected={selectedOrderIds.includes(row.id)}
                selectDisabled={!domesticLogisticsCanArchive(row)}
                colSpan={tableColSpan}
                onSelect={(checked) => toggleOrderSelection(row, checked)}
              />
            )) : (
              <tr>
                <td colSpan={tableColSpan}><div className={styles.emptyState}>未找到匹配的物流信息订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={rows.length} page={page} totalPages={totalPages} onPage={setPage} />
      </>
      )}
    </section>
    {activeLogisticsView === "list" ? (
      <LogisticsFeesModule
        sectionId="domestic-logistics-fees"
        embedded
        title="物流费用录入与审核"
        refreshToken={expenseRefreshToken}
        focusBillId={expenseFocus.billId}
        focusKeyword={expenseFocus.keyword}
        focusToken={expenseFocus.token}
        currentUserRole={currentUser.role}
        currentUserSupplierId={currentUser.supplierId || ""}
        canCreateExpense={canCreateLogisticsExpense}
      />
    ) : null}
    {confirmation ? (
      <ConfirmationDialog
        state={confirmation}
        onCancel={cancelConfirmation}
        onConfirm={confirmConfirmation}
        onInputChange={updateConfirmationInput}
      />
    ) : null}
    </>
  );
}

function ShipsgoControlTowerView({
  features,
  canManage,
  initialFullScreen = false,
  onOpenOrder,
}: {
  features: ShipsgoFeatureFlags;
  canManage: boolean;
  initialFullScreen?: boolean;
  onOpenOrder: (row: ShipsgoControlTowerRow) => void;
}) {
  const [rows, setRows] = useState<ShipsgoControlTowerRow[]>([]);
  const [stats, setStats] = useState<ShipsgoControlTowerStats>(EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
  const [filters, setFilters] = useState<ShipsgoControlTowerFilters>(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  const [submittedFilters, setSubmittedFilters] = useState<ShipsgoControlTowerFilters>(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [syncingId, setSyncingId] = useState("");
  const [fullScreen, setFullScreen] = useState(initialFullScreen);
  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);

  function setFilterValue<K extends keyof ShipsgoControlTowerFilters>(key: K, value: ShipsgoControlTowerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (error) setError("");
  }

  async function loadControlTower(nextFilters = submittedFilters, quiet = false) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = controlTowerSearchParams(nextFilters);
      const result = await apiJson<ShipsgoControlTowerResponse>(`/api/shipsgo/ocean-trackings/control-tower?${params}`);
      if (result.success === false) throw new Error(result.message || "读取运输监控失败");
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setStats(result.stats || EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
      setUpdatedAt(result.updatedAt || new Date().toISOString());
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "读取运输监控失败";
      console.error("读取运输监控失败", loadError);
      setError(message);
      if (!quiet) {
        setRows([]);
        setStats(EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    void loadControlTower(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  }, []);

  useEffect(() => {
    if (!fullScreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullScreen]);

  useEffect(() => {
    if (!fullScreen) return undefined;
    const timer = window.setInterval(() => {
      void loadControlTower(submittedFilters, true);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [fullScreen, submittedFilters]);

  function submitFilters() {
    setSubmittedFilters(filters);
    setExpandedId("");
    setSelectedId("");
    setNotice("");
    void loadControlTower(filters);
  }

  function resetFilters() {
    setFilters(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
    setSubmittedFilters(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
    setExpandedId("");
    setSelectedId("");
    setNotice("");
    void loadControlTower(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  }

  async function syncTracking(row: ShipsgoControlTowerRow) {
    if (!features.manualSyncEnabled || !canManage) return;
    setSyncingId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/shipsgo/ocean-trackings/${encodeURIComponent(row.id)}/sync`, {
        method: "POST",
      });
      if (result.success === false) throw new Error(result.message || "同步大掌櫃跟踪失败");
      await loadControlTower(submittedFilters, true);
      setNotice(result.message || "大掌櫃状态已同步");
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "同步大掌櫃跟踪失败";
      console.error("同步大掌櫃跟踪失败", syncError);
      setError(message);
    } finally {
      setSyncingId("");
    }
  }

  function toggleTimeline(row: ShipsgoControlTowerRow) {
    setExpandedId((current) => current === row.id ? "" : row.id);
  }

  return (
    <div className={fullScreen ? styles.controlTowerFullscreen : styles.controlTowerShell}>
      <div className={styles.controlTowerHeader}>
        <div>
          <h3>运输监控</h3>
          <span>集中监控已创建大掌櫃跟踪且尚未到港的在途海运业务</span>
        </div>
        <div className={styles.controlTowerHeaderActions}>
          <span>最后更新时间：{updatedAt ? formatDateTime(updatedAt) : "暂无"}</span>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadControlTower(submittedFilters)} disabled={loading}>
            {loading ? "刷新中..." : "刷新数据"}
          </button>
          <button className={styles.primaryButtonCompact} type="button" onClick={() => setFullScreen((current) => !current)}>
            {fullScreen ? "退出全屏" : "全屏查看"}
          </button>
        </div>
      </div>

      <div className={styles.controlTowerStats}>
        <ControlTowerStatCard label="在途总票数" value={stats.inTransitCount} tone="blue" />
        <ControlTowerStatCard label="即将到港" value={stats.soonArrivingCount} tone="orange" />
        <ControlTowerStatCard label="ETA 已过期" value={stats.etaOverdueCount} tone="red" />
        <ControlTowerStatCard label="同步失败" value={stats.syncFailedCount} tone="rose" />
        <ControlTowerStatCard label="今日已同步" value={stats.syncedTodayCount} tone="green" />
      </div>

      {!fullScreen ? (
        <div className={styles.controlTowerFilters}>
          <input value={filters.customer} onChange={(event) => setFilterValue("customer", event.target.value)} placeholder="客户简称" />
          <input value={filters.orderNo} onChange={(event) => setFilterValue("orderNo", event.target.value)} placeholder="订单号" />
          <input value={filters.masterBlNo} onChange={(event) => setFilterValue("masterBlNo", event.target.value)} placeholder="Master B/L" />
          <input value={filters.carrier} onChange={(event) => setFilterValue("carrier", event.target.value)} placeholder="船公司" />
          <input value={filters.origin} onChange={(event) => setFilterValue("origin", event.target.value)} placeholder="起运港" />
          <input value={filters.destination} onChange={(event) => setFilterValue("destination", event.target.value)} placeholder="目的港" />
          <select value={filters.status} onChange={(event) => setFilterValue("status", event.target.value)}>
            <option value="">全部状态</option>
            <option value="航行中">航行中</option>
            <option value="已离港">已离港</option>
            <option value="已到港">已到港</option>
            <option value="待更新">待更新</option>
            <option value="同步失败">同步失败</option>
          </select>
          <input type="date" value={filters.etaStart} onChange={(event) => setFilterValue("etaStart", event.target.value)} aria-label="ETA 开始日期" />
          <input type="date" value={filters.etaEnd} onChange={(event) => setFilterValue("etaEnd", event.target.value)} aria-label="ETA 结束日期" />
          <select value={filters.overdue} onChange={(event) => setFilterValue("overdue", event.target.value)}>
            <option value="">是否逾期</option>
            <option value="true">ETA 已过期</option>
            <option value="false">未逾期</option>
          </select>
          <select value={filters.syncFailed} onChange={(event) => setFilterValue("syncFailed", event.target.value)}>
            <option value="">同步状态</option>
            <option value="true">同步失败</option>
            <option value="false">同步正常</option>
          </select>
          <select value={filters.includeCompleted ? "true" : "false"} onChange={(event) => setFilterValue("includeCompleted", event.target.value === "true")}>
            <option value="false">隐藏已到港/已完成</option>
            <option value="true">显示已到港/已完成</option>
          </select>
          <button className={styles.primaryButtonCompact} type="button" onClick={submitFilters} disabled={loading}>查询</button>
          <button className={styles.secondaryButton} type="button" onClick={resetFilters} disabled={loading}>重置</button>
        </div>
      ) : null}

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      {fullScreen ? (
        <div className={styles.controlTowerBigScreen} onClick={() => setSelectedId("")}>
          <div className={styles.controlTowerNodeBoard}>
            {rows.length ? rows.map((row) => (
              <button
                key={row.id}
                className={`${styles.controlTowerNodeCard} ${controlTowerNodeClass(row)}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(row.id);
                }}
              >
                <div className={styles.controlTowerNodeTop}>
                  <span className={`${styles.statusPill} ${controlTowerStatusClass(row)}`}>{controlTowerStatusText(row)}</span>
                  <strong>{row.orderNo || "-"}</strong>
                </div>
                <div className={styles.controlTowerRouteLine}>
                  <span>{shipsgoPortText(row.originPortName || row.originName, row.originPortCode)}</span>
                  <span>{row.latestNodeDescription || "当前节点待更新"}</span>
                  <span>{shipsgoPortText(row.destinationPortName || row.destinationName, row.destinationPortCode)}</span>
                </div>
                <div className={styles.controlTowerNodeMeta}>
                  <span>ETA：{row.eta || "暂无 ETA"}</span>
                  <span>{shipsgoVesselVoyage(row)}</span>
                </div>
                <ControlTowerTooltip row={row} />
              </button>
            )) : <div className={styles.emptyState}>暂无在途海运跟踪</div>}
          </div>
          {selectedRow ? (
            <ControlTowerDetailPanel
              row={selectedRow}
              canManage={canManage}
              features={features}
              syncing={syncingId === selectedRow.id}
              onSync={() => void syncTracking(selectedRow)}
              onOpenOrder={() => onOpenOrder(selectedRow)}
              onToggleTimeline={() => toggleTimeline(selectedRow)}
              timelineExpanded={expandedId === selectedRow.id}
            />
          ) : null}
        </div>
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户简称</th>
              <th>Master B/L</th>
              <th>船公司</th>
              <th>船名航次</th>
              <th>起运港</th>
              <th>目的港</th>
              <th>ETA</th>
              <th>当前状态</th>
              <th>最新节点</th>
              <th>最后同步</th>
              <th>柜号数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13}><div className={styles.emptyState}>控制塔数据加载中...</div></td></tr>
            ) : rows.length ? rows.map((row) => (
              <Fragment key={row.id}>
                <tr className={styles.clickableRow}>
                  <td><strong>{row.orderNo || "-"}</strong></td>
                  <td title={row.customerName || row.customerShortName || ""}>{row.customerShortName || "-"}</td>
                  <td>{row.masterBlNo || row.bookingNumber || "-"}</td>
                  <td>{shipsgoCarrierText(row)}</td>
                  <td>{shipsgoVesselVoyage(row)}</td>
                  <td>{shipsgoPortText(row.originPortName || row.originName, row.originPortCode)}</td>
                  <td>{shipsgoPortText(row.destinationPortName || row.destinationName, row.destinationPortCode)}</td>
                  <td>{row.eta || "暂无 ETA"}</td>
                  <td>
                    <div className={styles.controlTowerStatusStack}>
                      <span className={`${styles.statusPill} ${controlTowerStatusClass(row)}`}>{controlTowerStatusText(row)}</span>
                      {(row.alertLabels || []).map((label) => <span className={controlTowerAlertClass(label)} key={label}>{label}</span>)}
                    </div>
                  </td>
                  <td title={row.latestNodeDescription || ""}>{row.latestNodeDescription || "大掌櫃暂未返回运输节点"}</td>
                  <td>{row.lastSyncTime || row.lastSyncedAt ? formatDateTime(row.lastSyncTime || row.lastSyncedAt) : "暂无同步记录"}</td>
                  <td>{row.containerCount || row.containerNumbers?.length || 0}</td>
                  <td>
                    <div className={styles.controlTowerRowActions}>
                      {features.manualSyncEnabled && canManage ? (
                        <button className={styles.primaryButtonCompact} type="button" disabled={syncingId === row.id} onClick={() => void syncTracking(row)}>
                          {syncingId === row.id ? "同步中..." : "同步最新状态"}
                        </button>
                      ) : null}
                      <button className={styles.secondaryButton} type="button" onClick={() => toggleTimeline(row)}>
                        {expandedId === row.id ? "收起节点" : "查看运输节点"}
                      </button>
                      {row.mapUrl && features.liveMapEnabled ? <a className={styles.secondaryButton} href={row.mapUrl} target="_blank" rel="noreferrer">查看地图</a> : null}
                      <button className={styles.secondaryButton} type="button" onClick={() => onOpenOrder(row)}>跳转物流详情</button>
                    </div>
                  </td>
                </tr>
                {expandedId === row.id ? (
                  <tr className={styles.detailRow} key={`${row.id}-timeline`}>
                    <td colSpan={13}>
                      <ControlTowerTimeline row={row} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )) : (
              <tr><td colSpan={13}><div className={styles.emptyState}>暂无符合条件的海运跟踪</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ControlTowerStatCard({ label, value, tone }: { label: string; value: number; tone: "blue" | "orange" | "red" | "rose" | "green" }) {
  return (
    <div className={`${styles.controlTowerStatCard} ${controlTowerStatToneClass(tone)}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function controlTowerStatToneClass(tone: "blue" | "orange" | "red" | "rose" | "green") {
  if (tone === "orange") return styles.controlTowerStatOrange;
  if (tone === "red") return styles.controlTowerStatRed;
  if (tone === "rose") return styles.controlTowerStatRose;
  if (tone === "green") return styles.controlTowerStatGreen;
  return styles.controlTowerStatBlue;
}

function controlTowerSearchParams(filters: ShipsgoControlTowerFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (typeof value === "boolean") {
      if (value) params.set(key, "true");
      return;
    }
    if (value.trim()) params.set(key, value.trim());
  });
  return params.toString();
}

function controlTowerStatusText(row: ShipsgoControlTowerRow) {
  if (row.isSyncFailed) return "同步失败";
  if (row.isEtaOverdue) return "ETA 已过期";
  if (row.isSoonArriving) return "即将到港";
  return shipsgoTrackingStatusText(row);
}

function controlTowerStatusClass(row: ShipsgoControlTowerRow) {
  if (row.isSyncFailed) return styles.statusDanger;
  if (row.isEtaOverdue) return styles.statusDanger;
  if (row.isSoonArriving) return styles.statusWarning;
  if (row.isCompleted) return styles.statusSuccess;
  return styles.statusInfo;
}

function controlTowerNodeClass(row: ShipsgoControlTowerRow) {
  if (row.isSyncFailed) return styles.controlTowerNodeFailed;
  if (row.isEtaOverdue) return styles.controlTowerNodeOverdue;
  if (row.isSoonArriving) return styles.controlTowerNodeSoon;
  if (row.isCompleted) return styles.controlTowerNodeDone;
  return styles.controlTowerNodeNormal;
}

function controlTowerAlertClass(label: string) {
  if (label.includes("失败") || label.includes("过期")) return styles.controlTowerAlertDanger;
  if (label.includes("即将")) return styles.controlTowerAlertWarning;
  return styles.controlTowerAlertMuted;
}

function controlTowerTimelineEvents(row: ShipsgoTrackingRow) {
  return Array.isArray(row.timeline) ? row.timeline : [];
}

function ControlTowerTimeline({ row }: { row: ShipsgoControlTowerRow }) {
  const events = controlTowerTimelineEvents(row);
  return (
    <div className={styles.shipsgoTimelinePanel}>
      <strong>运输节点时间轴</strong>
      {events.length ? (
        <div className={styles.shipsgoTimelineList}>
          {events.map((event, index) => (
            <div className={styles.shipsgoTimelineItem} key={`${event.time || "no-time"}-${event.location || "no-location"}-${index}`}>
              <div className={styles.shipsgoTimelineDot} aria-hidden="true" />
              <div className={styles.shipsgoTimelineContent}>
                <div className={styles.shipsgoTimelineHeader}>
                  <strong>{event.time ? formatDateTime(event.time) : "时间未返回"}</strong>
                  <span>数据来源：{event.source || "大掌櫃"}</span>
                </div>
                <span>地点：{formatShipsgoPortForLocale(event.location, "", "zh-CN") || shipsgoValue(event.location)}</span>
                <span>状态：{formatShipsgoStatusForLocale(event.description, "zh-CN") || shipsgoValue(event.description)}</span>
                <span>船名/航次：{[event.vesselName, event.voyage].filter(Boolean).join(" / ") || "未返回"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.shipsgoTimelineState}>大掌櫃暂未返回运输节点。</div>
      )}
    </div>
  );
}

function ControlTowerTooltip({ row }: { row: ShipsgoControlTowerRow }) {
  return (
    <div className={styles.controlTowerTooltip} role="tooltip">
      <strong>{row.orderNo || "-"}</strong>
      <span>客户简称：{row.customerShortName || "-"}</span>
      <span>Master B/L：{row.masterBlNo || row.bookingNumber || "-"}</span>
      <span>集装箱号：{shipsgoContainerTags(row).join(" / ") || "-"}</span>
      <span>船公司：{shipsgoCarrierText(row)}</span>
      <span>船名航次：{shipsgoVesselVoyage(row)}</span>
      <span>当前状态：{controlTowerStatusText(row)}</span>
      <span>当前节点：{row.latestNodeDescription || "大掌櫃暂未返回运输节点"}</span>
      <span>节点时间：{row.latestNodeTime ? formatDateTime(row.latestNodeTime) : "未返回"}</span>
      <span>起运港：{shipsgoPortText(row.originPortName || row.originName, row.originPortCode)}</span>
      <span>目的港：{shipsgoPortText(row.destinationPortName || row.destinationName, row.destinationPortCode)}</span>
      <span>ETA：{row.eta || "暂无 ETA"}</span>
      <span>最后同步：{row.lastSyncTime || row.lastSyncedAt ? formatDateTime(row.lastSyncTime || row.lastSyncedAt) : "暂无同步记录"}</span>
    </div>
  );
}

function ControlTowerDetailPanel({
  row,
  canManage,
  features,
  syncing,
  onSync,
  onOpenOrder,
  onToggleTimeline,
  timelineExpanded,
}: {
  row: ShipsgoControlTowerRow;
  canManage: boolean;
  features: ShipsgoFeatureFlags;
  syncing: boolean;
  onSync: () => void;
  onOpenOrder: () => void;
  onToggleTimeline: () => void;
  timelineExpanded: boolean;
}) {
  return (
    <aside className={styles.controlTowerDetailPanel} onClick={(event) => event.stopPropagation()}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{row.orderNo || "-"}</strong>
          <span>{row.masterBlNo || row.bookingNumber || "-"} ｜ {shipsgoTrackingStatusText(row)}</span>
        </div>
      </div>
      <div className={styles.shipsgoContainerTags}>
        {shipsgoContainerTags(row).length ? shipsgoContainerTags(row).map((containerNo) => (
          <span key={containerNo}>{containerNo}</span>
        )) : <span>未返回</span>}
      </div>
      <ControlTowerTimeline row={row} />
      <div className={styles.controlTowerRowActions}>
        {features.manualSyncEnabled && canManage ? (
          <button className={styles.primaryButtonCompact} type="button" disabled={syncing} onClick={onSync}>{syncing ? "同步中..." : "同步最新状态"}</button>
        ) : null}
        <button className={styles.secondaryButton} type="button" onClick={onToggleTimeline}>{timelineExpanded ? "收起运输节点" : "展开运输节点"}</button>
        {row.mapUrl && features.liveMapEnabled ? <a className={styles.secondaryButton} href={row.mapUrl} target="_blank" rel="noreferrer">查看地图</a> : null}
        <button className={styles.secondaryButton} type="button" onClick={onOpenOrder}>跳转物流详情</button>
      </div>
    </aside>
  );
}

function defaultShipsgoMasterBl(row: DomesticLogisticsRow) {
  return String(row.blNo || row.billOfLadingNo || "").trim();
}

function shipsgoContainerTags(tracking: ShipsgoTrackingRow) {
  const containers = Array.isArray(tracking.containerNumbers) ? tracking.containerNumbers : [];
  return Array.from(new Set([...(containers || []), tracking.containerNumber || ""].map((item) => item.trim()).filter(Boolean)));
}

function shipsgoValue(value: unknown, fallback = "未返回") {
  const text = String(value || "").trim();
  return text && text !== "-" ? text : fallback;
}

function shipsgoVesselVoyage(tracking: ShipsgoTrackingRow) {
  return [tracking.vesselName, tracking.voyage].map((item) => String(item || "").trim()).filter(Boolean).join(" / ") || "暂无船名航次";
}

function shipsgoCarrierText(tracking: ShipsgoTrackingRow) {
  return formatShipsgoCarrierForLocale(tracking.carrierName || tracking.carrierScac, tracking.carrierScac, "zh-CN") || shipsgoValue(tracking.carrierName || tracking.carrierScac);
}

function shipsgoPortText(name: unknown, code: unknown = "") {
  return formatShipsgoPortForLocale(name, code, "zh-CN") || "大掌櫃未返回";
}

function shipsgoTrackingMethodText(method = "Master B/L") {
  return formatShipsgoTrackingMethodForLocale(method, "zh-CN") || "主提单跟踪";
}

function shipsgoSyncTime(tracking: ShipsgoTrackingRow) {
  const value = tracking.lastSyncTime || tracking.lastSyncedAt || "";
  return value ? formatDateTime(value) : "暂无同步记录";
}

function shipsgoTrackingStatusText(tracking: ShipsgoTrackingRow) {
  const syncStatus = String(tracking.syncStatus || "").toUpperCase();
  const status = String(tracking.currentStatus || tracking.status || "").toUpperCase();
  if (/FAIL|ERROR/.test(syncStatus)) return "同步失败";
  if (!tracking.shipsgoShipmentId && !tracking.lastSyncTime && !tracking.lastSyncedAt) return "已创建，待同步";
  const translated = formatShipsgoStatusForLocale(tracking.currentStatus || tracking.status || tracking.statusLabel, "zh-CN");
  if (translated && !/UNKNOWN|未知/i.test(translated)) return translated;
  if (tracking.statusLabel && !/未知/.test(tracking.statusLabel)) return tracking.statusLabel;
  return "已创建，待同步";
}

function shouldShowShipsgoRecover(tracking: ShipsgoTrackingRow) {
  const syncStatus = String(tracking.syncStatus || "").toUpperCase();
  return !tracking.shipsgoShipmentId || /FAIL|ERROR|NOT_SYNCED/.test(syncStatus);
}

function ShipsgoOrderTrackingPanel({
  row,
  features,
  canManage,
  busyKey,
  onCreate,
  onSync,
  onRecover,
}: {
  row: DomesticLogisticsRow;
  features: ShipsgoFeatureFlags;
  canManage: boolean;
  busyKey: string;
  onCreate: (payload: { masterBlNo: string; carrierScac?: string }) => Promise<void>;
  onSync: (trackingId: string) => Promise<ShipsgoTrackingRow>;
  onRecover: () => Promise<void>;
}) {
  const trackings = row.shipsgoTrackings || [];
  const hasTracking = trackings.length > 0;
  const [carrierScac, setCarrierScac] = useState("");
  const [masterBlNo, setMasterBlNo] = useState(defaultShipsgoMasterBl(row));
  const [showCarrierInput, setShowCarrierInput] = useState(false);
  const [createError, setCreateError] = useState("");
  const [expandedTimelineId, setExpandedTimelineId] = useState("");
  const [timelineLoadingId, setTimelineLoadingId] = useState("");
  const [timelineErrors, setTimelineErrors] = useState<Record<string, string>>({});
  const createBusy = busyKey === `${row.id}:shipsgo:create`;
  const recoverBusy = busyKey === `${row.id}:shipsgo:recover`;
  const canCreate = canManage && Boolean(features.oceanTrackingEnabled);

  useEffect(() => {
    setMasterBlNo(defaultShipsgoMasterBl(row));
    setCarrierScac("");
    setShowCarrierInput(false);
    setCreateError("");
    setExpandedTimelineId("");
    setTimelineLoadingId("");
    setTimelineErrors({});
  }, [row.id, row.blNo, row.billOfLadingNo, row.domesticLogisticsInfo?.id]);

  function updateCarrierScac(value: string) {
    setCarrierScac(value.toUpperCase());
    if (createError) setCreateError("");
  }

  function updateMasterBlNo(value: string) {
    setMasterBlNo(value.trim());
    if (createError) setCreateError("");
  }

  async function submitCreateTracking() {
    setCreateError("");
    try {
      await onCreate({ masterBlNo, carrierScac: showCarrierInput ? carrierScac : "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建大掌櫃跟踪失败";
      setCreateError(message);
      if (/船公司|SCAC|carrier/i.test(message)) setShowCarrierInput(true);
    }
  }

  function shipsgoTimelineEvents(tracking: ShipsgoTrackingRow) {
    return Array.isArray(tracking.timeline) ? tracking.timeline : [];
  }

  async function toggleTimeline(tracking: ShipsgoTrackingRow) {
    setTimelineErrors((current) => ({ ...current, [tracking.id]: "" }));
    if (expandedTimelineId === tracking.id) {
      setExpandedTimelineId("");
      return;
    }
    setExpandedTimelineId(tracking.id);
    if (!tracking.shipsgoShipmentId) {
      setTimelineErrors((current) => ({
        ...current,
        [tracking.id]: "本地未保存大掌櫃跟踪ID，请先从大掌櫃同步已有跟踪。",
      }));
      return;
    }
    if (shipsgoTimelineEvents(tracking).length) return;
    setTimelineLoadingId(tracking.id);
    try {
      await onSync(tracking.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步大掌櫃跟踪失败";
      console.error("读取大掌櫃运输状态失败", error);
      setTimelineErrors((current) => ({
        ...current,
        [tracking.id]: `读取大掌櫃运输状态失败：${message}`,
      }));
    } finally {
      setTimelineLoadingId("");
    }
  }

  async function syncTrackingAndTimeline(tracking: ShipsgoTrackingRow) {
    setTimelineErrors((current) => ({ ...current, [tracking.id]: "" }));
    try {
      await onSync(tracking.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步大掌櫃跟踪失败";
      console.error("同步大掌櫃运输状态失败", error);
      if (expandedTimelineId === tracking.id) {
        setTimelineErrors((current) => ({
          ...current,
          [tracking.id]: `读取大掌櫃运输状态失败：${message}`,
        }));
      }
    }
  }

  return (
    <section className={styles.documentGroupCard}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>大掌櫃海运跟踪</strong>
        </div>
      </div>
      {trackings.length ? (
        <div className={styles.shipsgoTrackingList}>
          {trackings.map((tracking) => {
            const syncBusy = busyKey === `${tracking.id}:shipsgo:sync`;
            const containers = shipsgoContainerTags(tracking);
            const etaText = tracking.eta || tracking.predictedDischargeDate || tracking.dateOfDischarge || "";
            const showRecover = canManage && shouldShowShipsgoRecover(tracking);
            const timelineExpanded = expandedTimelineId === tracking.id;
            const timelineLoading = timelineLoadingId === tracking.id || syncBusy && timelineExpanded && !shipsgoTimelineEvents(tracking).length;
            const timelineError = timelineErrors[tracking.id] || "";
            const timelineEvents = shipsgoTimelineEvents(tracking);
            return (
              <article className={styles.shipsgoTrackingCard} key={tracking.id}>
                <div className={styles.shipsgoTrackingSummary}>
                  <span className={styles.shipsgoStatusBadge}>{shipsgoTrackingStatusText(tracking)}</span>
                  <strong>预计到港 ETA：{shipsgoValue(etaText, "暂无 ETA")}</strong>
                  <span>最后同步时间：{shipsgoSyncTime(tracking)}</span>
                </div>

                <div className={styles.shipsgoTrackingInfoGrid}>
                  <div className={styles.shipsgoInfoColumn}>
                    <div className={styles.shipsgoInfoItem}>
                      <span>船公司</span>
                      <strong>{shipsgoCarrierText(tracking)}</strong>
                    </div>
                    <div className={styles.shipsgoInfoItem}>
                      <span>Master B/L</span>
                      <strong>{shipsgoValue(tracking.masterBlNo || tracking.bookingNumber)}</strong>
                    </div>
                    <div className={styles.shipsgoInfoItem}>
                      <span>船名航次</span>
                      <strong>{shipsgoVesselVoyage(tracking)}</strong>
                    </div>
                  </div>
                  <div className={styles.shipsgoInfoColumn}>
                    <div className={styles.shipsgoInfoItem}>
                      <span>起运港</span>
                      <strong>{shipsgoPortText(tracking.originPortName || tracking.originName, tracking.originPortCode)}</strong>
                    </div>
                    <div className={styles.shipsgoInfoItem}>
                      <span>目的港</span>
                      <strong>{shipsgoPortText(tracking.destinationPortName || tracking.destinationName, tracking.destinationPortCode)}</strong>
                    </div>
                    <div className={styles.shipsgoInfoItem}>
                      <span>跟踪方式</span>
                      <strong>{shipsgoTrackingMethodText("Master B/L")}</strong>
                    </div>
                  </div>
                </div>

                <div className={styles.shipsgoContainerBlock}>
                  <span>关联柜号</span>
                  <div className={styles.shipsgoContainerTags}>
                    {containers.length ? containers.map((containerNo) => (
                      <span key={containerNo}>{containerNo}</span>
                    )) : <span>未返回</span>}
                  </div>
                </div>

                {tracking.syncMessage ? <span className={styles.shipsgoSyncMessage}>同步提示：{tracking.syncMessage}</span> : null}
                <div className={styles.shipsgoTrackingActions}>
                  {features.manualSyncEnabled && canManage ? (
                    <button
                      className={styles.primaryButtonCompact}
                      type="button"
                      disabled={syncBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void syncTrackingAndTimeline(tracking);
                      }}
                    >
                      {syncBusy ? "同步中..." : "同步最新状态"}
                    </button>
                  ) : null}
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleTimeline(tracking);
                    }}
                  >
                    {timelineExpanded ? "收起运输状态" : "查看运输状态"}
                  </button>
                  {tracking.mapUrl && features.liveMapEnabled ? (
                    <a className={styles.secondaryButton} href={tracking.mapUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                      查看地图
                    </a>
                  ) : null}
                  {showRecover ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={recoverBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onRecover();
                      }}
                    >
                      {recoverBusy ? "同步中..." : "从大掌櫃同步已有跟踪"}
                    </button>
                  ) : null}
                </div>
                {timelineExpanded ? (
                  <div className={styles.shipsgoTimelinePanel}>
                    <strong>运输状态时间轴</strong>
                    {timelineLoading ? (
                      <div className={styles.shipsgoTimelineState}>正在读取大掌櫃运输状态...</div>
                    ) : timelineError ? (
                      <div className={styles.shipsgoTimelineError} role="alert">{timelineError}</div>
                    ) : timelineEvents.length ? (
                      <div className={styles.shipsgoTimelineList}>
                        {timelineEvents.map((event, index) => (
                          <div className={styles.shipsgoTimelineItem} key={`${event.time || "no-time"}-${event.location || "no-location"}-${index}`}>
                            <div className={styles.shipsgoTimelineDot} aria-hidden="true" />
                            <div className={styles.shipsgoTimelineContent}>
                              <div className={styles.shipsgoTimelineHeader}>
                                <strong>{event.time ? formatDateTime(event.time) : "时间未返回"}</strong>
                                <span>数据来源：{event.source || "大掌櫃"}</span>
                              </div>
                              <span>地点：{formatShipsgoPortForLocale(event.location, "", "zh-CN") || shipsgoValue(event.location)}</span>
                              <span>状态：{formatShipsgoStatusForLocale(event.description, "zh-CN") || shipsgoValue(event.description)}</span>
                              <span>船名/航次：{[event.vesselName, event.voyage].filter(Boolean).join(" / ") || "未返回"}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.shipsgoTimelineState}>大掌櫃暂未返回运输节点。</div>
                    )}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>暂未创建大掌櫃跟踪</div>
      )}
      {canCreate && !hasTracking ? (
        <div className={styles.reportFilterGrid} onClick={(event) => event.stopPropagation()}>
          <label>
            Master B/L（提单号）
            <input value={masterBlNo} onChange={(event) => updateMasterBlNo(event.target.value)} placeholder="请输入 Master B/L" />
          </label>
          {showCarrierInput ? (
            <label>
              船公司 SCAC（仅识别失败时填写）
              <input value={carrierScac} onChange={(event) => updateCarrierScac(event.target.value)} placeholder="例如 MAEU / CMDU" />
            </label>
          ) : null}
          {createError ? (
            <div className={`${styles.inlineError} ${styles.shipsgoCreateError}`} role="alert">
              {createError}
            </div>
          ) : null}
          <label>
            跟踪
            <button
              className={styles.primaryButtonCompact}
              type="button"
              disabled={createBusy || recoverBusy}
              onClick={(event) => {
                event.stopPropagation();
                void submitCreateTracking();
              }}
            >
              {createBusy ? "创建中..." : "开始追踪"}
            </button>
          </label>
          <label>
            已有跟踪
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={createBusy || recoverBusy}
              onClick={(event) => {
                event.stopPropagation();
                void onRecover();
              }}
            >
              {recoverBusy ? "同步中..." : "从大掌櫃同步已有跟踪"}
            </button>
          </label>
        </div>
      ) : null}
    </section>
  );
}

function DomesticLogisticsRows({
  row,
  expanded,
  editing,
  feeEntryOpen,
  canEditDomesticLogistics,
  canUploadCustomsDocuments,
  canDeleteCustomsDocuments,
  onToggle,
  onEdit,
  canCreateLogisticsExpense,
  currentUserRole,
  currentUserSupplierId,
  onOpenExpenseStatus,
  onOpenFeeEntry,
  onCloseFeeEntry,
  shipsgoFeatures,
  shipsgoBusyKey,
  canManageShipsgoTracking,
  onCreateShipsgoTracking,
  onSyncShipsgoTracking,
  onRecoverShipsgoTracking,
  onSaved,
  onCancelEdit,
  canDeleteDomesticLogistics,
  onDeleteDomesticLogistics,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  onUploadDocument,
  onDeleteDocument,
  selectionEnabled,
  selected,
  selectDisabled,
  colSpan,
  onSelect,
}: {
  row: DomesticLogisticsRow;
  expanded: boolean;
  editing: boolean;
  feeEntryOpen: boolean;
  canEditDomesticLogistics: boolean;
  canUploadCustomsDocuments: boolean;
  canDeleteCustomsDocuments: boolean;
  onToggle: () => void;
  onEdit: () => void;
  canCreateLogisticsExpense: boolean;
  currentUserRole: string;
  currentUserSupplierId: string;
  onOpenExpenseStatus: () => void;
  onOpenFeeEntry: () => void;
  onCloseFeeEntry: () => void;
  shipsgoFeatures: ShipsgoFeatureFlags;
  shipsgoBusyKey: string;
  canManageShipsgoTracking: boolean;
  onCreateShipsgoTracking: (payload: { masterBlNo: string; carrierScac?: string }) => Promise<void>;
  onSyncShipsgoTracking: (trackingId: string) => Promise<ShipsgoTrackingRow>;
  onRecoverShipsgoTracking: () => Promise<void>;
  onSaved: () => void;
  onCancelEdit: () => void;
  canDeleteDomesticLogistics: boolean;
  onDeleteDomesticLogistics: () => void;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  onUploadDocument: (orderId: string, documentType: string, file: File | null) => void;
  onDeleteDocument: (document: DomesticLogisticsDocument) => void;
  selectionEnabled: boolean;
  selected: boolean;
  selectDisabled: boolean;
  colSpan: number;
  onSelect: (checked: boolean) => void;
}) {
  const info = row.domesticLogisticsInfo;
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        {selectionEnabled ? (
          <td className={styles.selectionColumn} onClick={(event) => event.stopPropagation()}>
            <UiCheckbox
              variant="table"
              label={`选择订单 ${row.orderNo || row.id}`}
              checked={selected}
              disabled={selectDisabled}
              title={selectDisabled ? ARCHIVE_BUTTON_DISABLED_TOOLTIP : "选择此订单归档"}
              onChange={(event) => onSelect(event.target.checked)}
            />
          </td>
        ) : null}
        <td><strong>{row.orderNo || "-"}</strong></td>
        <td title={customerLegalName(row)}>{customerDisplayName(row)}</td>
        <td>{info?.destinationPlace || firstItemValue(info, "arrivalPlace") || "-"}</td>
        <td>{info?.cargoDescription || firstItemValue(info, "cargoName") || "-"}</td>
        <td><span className={`${styles.statusPill} ${row.logisticsStatus === "已提交" ? styles.statusSuccess : styles.statusWarning}`}>{row.logisticsStatus || "未提交"}</span></td>
        <td><DomesticLogisticsExpenseStatusButton row={row} onOpen={onOpenExpenseStatus} /></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={colSpan}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                {canCreateLogisticsExpense ? (
                  <button
                    className={`${styles.logisticsActionBtn} ${styles.logisticsSecondaryBtn}`}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onOpenFeeEntry(); }}
                  >
                    录入费用
                  </button>
                ) : null}
                {canEditDomesticLogistics ? (
                  <button
                    className={`${styles.logisticsActionBtn} ${styles.logisticsPrimaryBtn} ${styles.logisticsEditBtn}`}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onEdit(); }}
                  >
                    {info ? "编辑物流信息" : "录入物流信息"}
                  </button>
                ) : null}
                {canDeleteDomesticLogistics && info?.id ? (
                  <button
                    className={`${styles.logisticsActionBtn} ${styles.logisticsDangerBtn}`}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onDeleteDomesticLogistics(); }}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              {editing ? (
                <DomesticLogisticsEditPanel row={row} onSaved={onSaved} onCancel={onCancelEdit} />
              ) : null}
              {feeEntryOpen ? (
                <LogisticsExpenseForm
                  initialOrder={expenseOrderFromDomesticRow(row)}
                  currentUserRole={currentUserRole}
                  currentUserSupplierId={currentUserSupplierId}
                  onCancel={onCloseFeeEntry}
                  onSaved={onSaved}
                />
              ) : null}
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={customerLegalName(row)} wide />
                <DetailField label="提单号" value={row.blNo || row.billOfLadingNo || "-"} />
                <DetailField label="运输方式" value={info?.transportTypeLabel || "-"} />
                <DetailField label="起运地" value={info?.departurePlace || firstItemValue(info, "departurePlace") || "-"} />
                <DetailField label="到达地" value={info?.destinationPlace || firstItemValue(info, "arrivalPlace") || "-"} />
                <DetailField label="起运日期" value={info?.departureDate || firstItemValue(info, "departureDate") || "-"} />
                <DetailField label="车牌号 / 快递单号" value={info?.expressTrackingNo || info?.truckPlateNo || firstItemValue(info, "truckPlateNo") || "-"} />
                <DetailField label="运输货物名称" value={info?.cargoDescription || firstItemValue(info, "cargoName") || "-"} />
                <DetailField label="录入人" value={info?.submittedByName || "-"} />
                <DetailField label="录入时间" value={formatDateTime(info?.submittedAt || row.submittedAt)} />
              </div>
              {info?.transportItems?.length ? (
                <div className={styles.subList}>
                  <strong>集装箱运输明细</strong>
                  {info.transportItems.map((item, index) => (
                    <div className={styles.subListItem} key={`${item.containerNo || item.truckPlateNo || index}-${index}`}>
                      <strong>明细 {index + 1}{item.containerNo ? ` · ${item.containerNo}` : ""}</strong>
                      {showContainerManagementFields(info.transportType || "") ? (
                        <>
                          <span>柜型：{item.containerType || "-"}</span>
                          <span>封号：{item.sealNo || "-"}</span>
                        </>
                      ) : null}
                      <span>车牌号：{item.truckPlateNo || "-"}</span>
                      <span>挂车车牌：{item.trailerPlateNo || "-"}</span>
                      <span>起运日期：{formatDate(item.departureDate)}</span>
                      <span>起运地：{item.departurePlace || "-"}</span>
                      <span>到达地：{item.arrivalPlace || "-"}</span>
                      <span>运输货物名称：{item.cargoName || "-"}</span>
                      {item.remark ? <span>备注：{item.remark}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
                <ShipsgoOrderTrackingPanel
                  row={row}
                  features={shipsgoFeatures}
                  canManage={canManageShipsgoTracking}
                  busyKey={shipsgoBusyKey}
                  onCreate={onCreateShipsgoTracking}
                  onSync={onSyncShipsgoTracking}
                  onRecover={onRecoverShipsgoTracking}
                />
              ) : null}
              <CustomsDocumentPanel
                orderId={row.id}
                documents={row.documents || []}
                uploadingKey={uploadingKey}
                uploadProgressByKey={uploadProgressByKey}
                deletingDocumentId={deletingDocumentId}
                currentUserRole={currentUserRole}
                canUpload={canUploadCustomsDocuments}
                canDelete={canDeleteCustomsDocuments}
                onUpload={onUploadDocument}
                onDelete={onDeleteDocument}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DomesticLogisticsEditPanel({ row, onSaved, onCancel }: { row: DomesticLogisticsRow; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<DomesticLogisticsForm>(() => formFromRow(row));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function setFormValue<K extends keyof DomesticLogisticsForm>(key: K, value: DomesticLogisticsForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key !== "remarkText") {
        next.remarkText = generateRemark(next);
        next.remarkTextManualEdited = false;
      }
      return next;
    });
  }

  function updateItem(index: number, key: keyof TransportItem, value: string) {
    setForm((current) => {
      const transportItems = current.transportItems.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } : item
      ));
      const next = { ...current, transportItems };
      next.remarkText = generateRemark(next);
      next.remarkTextManualEdited = false;
      return next;
    });
  }

  function addItem(copyPrevious = false) {
    setForm((current) => {
      const previous = current.transportItems[current.transportItems.length - 1] || emptyTransportItem();
      const transportItems = [...current.transportItems, copyPrevious ? { ...previous, containerNo: "" } : emptyTransportItem()];
      const next = { ...current, transportItems };
      next.remarkText = generateRemark(next);
      next.remarkTextManualEdited = false;
      return next;
    });
  }

  function removeItem(index: number) {
    setForm((current) => {
      const transportItems = current.transportItems.filter((_, itemIndex) => itemIndex !== index);
      const next = { ...current, transportItems: transportItems.length ? transportItems : [emptyTransportItem()] };
      next.remarkText = generateRemark(next);
      next.remarkTextManualEdited = false;
      return next;
    });
  }

  async function regenerateRemark() {
    setForm((current) => ({ ...current, remarkText: generateRemark(current), remarkTextManualEdited: false }));
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateDomesticLogisticsForm(form);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const infoId = row.domesticLogisticsInfo?.id;
      const path = infoId ? `/api/domestic-logistics/${infoId}` : "/api/domestic-logistics";
      const isExpressPayload = form.transportType === "EXPRESS";
      const transportItems = isExpressPayload ? [] : normalizeFormTransportItems(form.transportItems);
      const firstItem = transportItems[0] || {};
      const remarkText = generateRemark({ ...form, transportItems });
      const result = await apiJson<{ success?: boolean; message?: string }>(path, {
        method: infoId ? "PATCH" : "POST",
        body: JSON.stringify({
          orderId: row.id,
          transportType: form.transportType,
          truckPlateNo: firstItem.truckPlateNo || "",
          trailerPlateNo: firstItem.trailerPlateNo || "",
          departurePlace: firstItem.departurePlace || "",
          departureDate: firstItem.departureDate || "",
          expressTrackingNo: isExpressPayload ? form.expressTrackingNo.trim() : "",
          destinationPlace: isExpressPayload ? form.destinationPlace.trim() : (firstItem.arrivalPlace || ""),
          cargoDescription: isExpressPayload ? form.cargoDescription.trim() : (firstItem.cargoName || ""),
          transportItems,
          remarkText,
          remarkTextManualEdited: false,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "物流信息保存失败");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "物流信息保存失败");
    } finally {
      setSaving(false);
    }
  }

  const isExpress = form.transportType === "EXPRESS";
  const transportLabels = transportFieldLabels(form.transportType);

  return (
    <>
    <form className={styles.inlineEditPanel} onKeyDown={preventEnterFormSubmit} onSubmit={submitForm} onClick={(event) => event.stopPropagation()}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>录入物流信息 - {row.orderNo || "-"}</strong>
          <span>提单号：{row.blNo || row.billOfLadingNo || "-"} ｜ 客户全称：{customerLegalName(row)}</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          运输方式
          <select value={form.transportType} onChange={(event) => setFormValue("transportType", event.target.value)}>
            {TRANSPORT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        {isExpress ? (
          <>
            <label>
              快递单号
              <input value={form.expressTrackingNo} onChange={(event) => setFormValue("expressTrackingNo", event.target.value)} required />
            </label>
            <label>
              到达地
              <input value={form.destinationPlace} onChange={(event) => setFormValue("destinationPlace", event.target.value)} required />
            </label>
            <label>
              运输货物名称
              <input value={form.cargoDescription} onChange={(event) => setFormValue("cargoDescription", event.target.value)} required />
            </label>
          </>
        ) : null}
      </div>

      {!isExpress ? (
        <div className={styles.transportItemsPanel}>
          <div className={styles.transportItemsHeader}>
            <strong>{transportItemsTitle(form.transportType)}</strong>
            <div>
              <button className={styles.secondaryButton} type="button" onClick={() => addItem(false)}>{addTransportItemText(form.transportType)}</button>
              <button className={styles.secondaryButton} type="button" onClick={() => addItem(true)}>复制上一行</button>
            </div>
          </div>
          <div className={styles.transportItemsGrid}>
            {form.transportItems.map((item, index) => (
              <div className={styles.transportItemCard} key={`transport-item-${index}`}>
                <strong>第 {index + 1} 行</strong>
                <label>{transportLabels.containerNo}<input value={item.containerNo || ""} onChange={(event) => updateItem(index, "containerNo", event.target.value)} /></label>
                {showContainerManagementFields(form.transportType) ? (
                  <>
                    <label>
                      柜型
                      <select value={item.containerType || ""} onChange={(event) => updateItem(index, "containerType", event.target.value)}>
                        <option value="">请选择柜型</option>
                        {CONTAINER_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                    <label>封号<input value={item.sealNo || ""} onChange={(event) => updateItem(index, "sealNo", event.target.value)} placeholder="可选" /></label>
                  </>
                ) : null}
                <label>{transportLabels.truckPlateNo}<input value={item.truckPlateNo || ""} onChange={(event) => updateItem(index, "truckPlateNo", event.target.value)} required /></label>
                <label>挂车车牌<input value={item.trailerPlateNo || ""} onChange={(event) => updateItem(index, "trailerPlateNo", event.target.value)} /></label>
                <label>{transportLabels.departureDate}<input type="date" value={item.departureDate || ""} onChange={(event) => updateItem(index, "departureDate", event.target.value)} required /></label>
                <label>{transportLabels.departurePlace}<input value={item.departurePlace || ""} onChange={(event) => updateItem(index, "departurePlace", event.target.value)} required /></label>
                <label>{transportLabels.arrivalPlace}<input value={item.arrivalPlace || ""} onChange={(event) => updateItem(index, "arrivalPlace", event.target.value)} required /></label>
                <label>{transportLabels.cargoName}<input value={item.cargoName || ""} onChange={(event) => updateItem(index, "cargoName", event.target.value)} required /></label>
                <label>备注<input value={item.remark || ""} onChange={(event) => updateItem(index, "remark", event.target.value)} /></label>
                <button className={styles.secondaryButton} type="button" onClick={() => removeItem(index)}>删除本行</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "提交中..." : "提交物流信息"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
    </>
  );
}

function CustomsDocumentPanel({
  orderId,
  documents,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  currentUserRole,
  canUpload,
  canDelete,
  onUpload,
  onDelete,
}: {
  orderId: string;
  documents: DomesticLogisticsDocument[];
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  currentUserRole: string;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null) => void;
  onDelete: (document: DomesticLogisticsDocument) => void;
}) {
  const canPreviewOrDownload = ["管理员", "财务", "物流资料录入员", "物流供应商"].includes(currentUserRole);
  return (
    <div className={styles.documentGroupCard}>
      <strong>报关资料上传</strong>
      {CUSTOMS_DOCUMENT_TYPES.map((documentType) => {
        const matchedDocuments = documents.filter((document) => (
          document.documentType === documentType.value && document.uploadStatus === "SUCCESS"
        ));
        const currentCustomsDeclaration = documentType.value === "CUSTOMS_ENTRY_FORM"
          ? latestUploadedDocument(matchedDocuments)
          : null;
        const uploading = uploadingKey === `${orderId}:${documentType.value}`;
        const uploadProgress = uploadProgressByKey[`${orderId}:${documentType.value}`] || 0;
        if (documentType.value === "CUSTOMS_ENTRY_FORM") {
          return (
            <div className={styles.fileListItem} key={documentType.value}>
              <div>
                <span>{documentType.label}</span>
                {currentCustomsDeclaration ? (
                  <small>
                    {currentCustomsDeclaration.fileName || "-"} ｜ {currentCustomsDeclaration.uploadedByName || "-"} ｜ {formatDateTime(currentCustomsDeclaration.uploadedAt)}
                  </small>
                ) : (
                  <small>暂未上传</small>
                )}
              </div>
              <div>
                {currentCustomsDeclaration && canPreviewOrDownload ? (
                  <>
                    <PdfPreviewButton documentId={currentCustomsDeclaration.id} fileName={currentCustomsDeclaration.fileName || ""} />
                    <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(currentCustomsDeclaration.id)}/download`}>下载</a>
                  </>
                ) : null}
                {canUpload ? (
                  <>
                    <label className={styles.secondaryButton}>
                      {uploading ? "识别中..." : UPLOAD_REPLACE_TEXT}
                      <input
                        type="file"
                        accept={PDF_UPLOAD_ACCEPT}
                        disabled={uploading}
                        hidden
                        onChange={(event) => {
                          onUpload(orderId, documentType.value, event.target.files?.[0] || null);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {uploading ? <UploadProgressInline progress={uploadProgress} /> : null}
                  </>
                ) : null}
                {currentCustomsDeclaration && canDelete ? (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={deletingDocumentId === currentCustomsDeclaration.id}
                    onClick={() => onDelete(currentCustomsDeclaration)}
                  >
                    {deletingDocumentId === currentCustomsDeclaration.id ? "删除中..." : "删除"}
                  </button>
                ) : null}
              </div>
            </div>
          );
        }
        return (
          <div className={styles.fileListItem} key={documentType.value}>
            <div>
              <span>{documentType.label}</span>
              <small>{matchedDocuments.length ? `已上传 ${matchedDocuments.length} 个文件` : "暂未上传"}</small>
              {matchedDocuments.map((document) => (
                <small key={document.id}>
                  {document.fileName || "-"} ｜ {document.uploadedByName || "-"} ｜ {formatDateTime(document.uploadedAt)}
                </small>
              ))}
            </div>
            <div>
              {canUpload ? (
                <>
                  <label className={styles.secondaryButton}>
                    {uploading
                      ? (documentType.value === "CUSTOMS_ENTRY_FORM" ? "识别中..." : "上传中...")
                      : UPLOAD_REPLACE_TEXT}
                    <input
                      type="file"
                      accept={PDF_UPLOAD_ACCEPT}
                      disabled={uploading}
                      hidden
                      onChange={(event) => {
                        onUpload(orderId, documentType.value, event.target.files?.[0] || null);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  {uploading ? <UploadProgressInline progress={uploadProgress} /> : null}
                </>
              ) : null}
              {matchedDocuments.map((document) => (
                <span key={document.id} className={styles.fileListItemActions}>
                  {canPreviewOrDownload ? (
                    <>
                      <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
                      <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
                    </>
                  ) : null}
                  {canDelete ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={deletingDocumentId === document.id}
                      onClick={() => onDelete(document)}
                    >
                      {deletingDocumentId === document.id ? "删除中..." : "删除"}
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UploadProgressInline({ progress }: { progress: number }) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress || 0)));
  return (
    <span className={styles.invoiceUploadStatus} data-status="uploading">
      <span className={styles.invoiceUploadProgressBar}>
        <span style={{ width: `${safeProgress}%` }} />
      </span>
      <span>状态：上传中 {safeProgress}%</span>
    </span>
  );
}

function DomesticLogisticsExpenseStatusButton({
  row,
  onOpen,
}: {
  row: DomesticLogisticsRow;
  onOpen: () => void;
}) {
  const status = row.logisticsExpenseStatusLabel || row.logisticsExpenseStatus || "未录入";
  return (
    <button
      className={`${styles.logisticsFeeStatusBadge} ${domesticLogisticsExpenseStatusClass(status)}`}
      type="button"
      title={status === "未录入" ? "点击录入物流费用" : "点击打开对应物流费用账单"}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {status}
    </button>
  );
}

function domesticLogisticsExpenseStatusClass(status = "") {
  if (status === "未录入") return styles.logisticsFeeStatusMuted;
  if (status === "草稿") return styles.logisticsFeeStatusDraft;
  if (status === "待审核") return styles.logisticsFeeStatusPending;
  if (status === "审核通过") return styles.logisticsFeeStatusApproved;
  if (status === "已驳回") return styles.logisticsFeeStatusRejected;
  if (status === "待开票") return styles.logisticsFeeStatusInvoice;
  if (status === "已上传发票") return styles.logisticsFeeStatusUploaded;
  if (status === "待付款") return styles.logisticsFeeStatusPayment;
  if (status === "部分付款") return styles.logisticsFeeStatusPartialPayment;
  if (status === "已付款") return styles.logisticsFeeStatusPaid;
  return styles.logisticsFeeStatusMuted;
}

function firstItemValue(info: DomesticLogisticsInfo | null | undefined, key: keyof TransportItem) {
  return info?.transportItems?.find((item) => item[key])?.[key] || "";
}

function latestUploadedDocument(documents: DomesticLogisticsDocument[]) {
  return documents.slice().sort((left, right) => (
    new Date(right.uploadedAt || 0).getTime() - new Date(left.uploadedAt || 0).getTime()
  ))[0] || null;
}

function expenseOrderFromDomesticRow(row: DomesticLogisticsRow) {
  const info = row.domesticLogisticsInfo;
  const transportItems = info?.transportItems || [];
  const containerNos = transportItems.map((item) => item.containerNo || "").filter(Boolean);
  const containerTypes = uniqueContainerTypes(transportItems.map((item) => item.containerType));
  return {
    id: row.orderId || row.id,
    orderId: row.orderId || row.id,
    orderNo: row.orderNo || "",
    blNo: row.blNo || row.billOfLadingNo || "",
    billOfLadingNo: row.billOfLadingNo || row.blNo || "",
    customerName: row.customerFullName || row.customerName || "",
    customerShortName: row.customerShortName || row.customerName || "",
    logisticsSuppliers: row.logisticsSuppliers || [],
    truckPlateNo: info?.truckPlateNo || firstItemValue(info, "truckPlateNo"),
    cargoName: info?.cargoDescription || firstItemValue(info, "cargoName"),
    containerNos,
    containerTypes,
    containerType: containerTypes.length === 1 ? containerTypes[0] : "",
    containerCount: containerNos.length || transportItems.length || 0,
    transportItems,
  };
}

function formFromRow(row: DomesticLogisticsRow): DomesticLogisticsForm {
  const info = row.domesticLogisticsInfo;
  const transportType = info?.transportType || "TRUCK";
  const transportItems = info?.transportItems?.length
    ? info.transportItems.map((item) => ({ ...emptyTransportItem(), ...item }))
    : [{
      ...emptyTransportItem(),
      truckPlateNo: info?.truckPlateNo || "",
      trailerPlateNo: info?.trailerPlateNo || "",
      departurePlace: info?.departurePlace || "",
      arrivalPlace: info?.destinationPlace || "",
      departureDate: info?.departureDate || "",
      cargoName: info?.cargoDescription || "",
    }];
  const form = {
    orderId: row.id,
    transportType,
    expressTrackingNo: info?.expressTrackingNo || "",
    destinationPlace: info?.destinationPlace || "",
    cargoDescription: info?.cargoDescription || "",
    remarkText: "",
    remarkTextManualEdited: false,
    transportItems,
  };
  return { ...form, remarkText: form.remarkText || generateRemark(form) };
}

function transportItemsTitle(transportType: string) {
  if (transportType === "BULK_WAREHOUSE") return "散货进舱明细";
  if (transportType === "MULTIMODAL") return "多式联运明细";
  return "集装箱管理";
}

function addTransportItemText(transportType: string) {
  if (transportType === "BULK_WAREHOUSE") return "新增进舱明细";
  return "新增集装箱";
}

function showContainerManagementFields(transportType: string) {
  return transportType !== "BULK_WAREHOUSE";
}

function transportFieldLabels(transportType: string) {
  if (transportType === "BULK_WAREHOUSE") {
    return {
      containerNo: "进舱编号/唛头",
      truckPlateNo: "送货车牌号",
      departureDate: "进舱日期",
      departurePlace: "提货地",
      arrivalPlace: "进舱仓库",
      cargoName: "货物名称",
    };
  }
  if (transportType === "MULTIMODAL") {
    return {
      containerNo: "集装箱号",
      truckPlateNo: "首程车牌号",
      departureDate: "起运日期",
      departurePlace: "首程起运地",
      arrivalPlace: "到达地",
      cargoName: "运输货物名称",
    };
  }
  return {
    containerNo: "集装箱号",
    truckPlateNo: "车牌号",
    departureDate: "起运日期",
    departurePlace: "起运地",
    arrivalPlace: "到达地",
    cargoName: "运输货物名称",
  };
}

function generateRemark(form: DomesticLogisticsForm) {
  if (form.transportType === "EXPRESS") {
    return [
      form.expressTrackingNo ? `快递单号：${form.expressTrackingNo}` : "",
      form.destinationPlace ? `到达地：${form.destinationPlace}` : "",
      form.cargoDescription ? `运输货物名称：${form.cargoDescription}` : "",
    ].filter(Boolean).join("\n");
  }
  return formatStructuredTransportRemarkText(buildStructuredTransportRemarkFromForm(form));
}

function buildStructuredTransportRemarkFromForm(form: Pick<DomesticLogisticsForm, "transportType" | "transportItems">): StructuredTransportRemark {
  if (form.transportType === "EXPRESS") return { containers: [] };
  return {
    containers: normalizeFormTransportItems(form.transportItems).map((item) => ({
      containerNo: item.containerNo,
      type: showContainerManagementFields(form.transportType) ? item.containerType : "",
      truckNo: item.truckPlateNo,
      trailerNo: item.trailerPlateNo,
      shipDate: item.departureDate,
      origin: item.departurePlace,
      destination: item.arrivalPlace,
      goods: item.cargoName,
    })),
  };
}

function formatStructuredTransportRemarkText(remark: StructuredTransportRemark) {
  return (remark.containers || []).map((item) => [
    `Container: ${item.containerNo || "-"}`,
    `柜型：${item.type || "-"}`,
    `车牌：${item.truckNo || "-"}`,
    `挂车：${item.trailerNo || "-"}`,
    `起运：${item.shipDate || "-"}`,
    `路线：${item.origin || "-"} → ${item.destination || "-"}`,
    `货物：${item.goods || "-"}`,
  ].join("\n")).join("\n\n");
}

function normalizeFormTransportItems(items: TransportItem[]) {
  return items.map((item) => ({
    containerNo: (item.containerNo || "").trim(),
    containerType: (item.containerType || "").trim().toUpperCase(),
    sealNo: (item.sealNo || "").trim(),
    truckPlateNo: (item.truckPlateNo || "").trim(),
    trailerPlateNo: (item.trailerPlateNo || "").trim(),
    departureDate: (item.departureDate || "").trim(),
    departurePlace: (item.departurePlace || "").trim(),
    arrivalPlace: (item.arrivalPlace || "").trim(),
    cargoName: (item.cargoName || "").trim(),
    remark: (item.remark || "").trim(),
  })).filter((item) => Object.values(item).some(Boolean));
}

function uniqueContainerTypes(values: unknown[]) {
  return values
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function validateDomesticLogisticsForm(form: DomesticLogisticsForm) {
  if (form.transportType === "EXPRESS") {
    if (!form.expressTrackingNo.trim()) return "请填写快递单号。";
    if (!form.destinationPlace.trim()) return "请填写到达地。";
    if (!form.cargoDescription.trim()) return "请填写运输货物名称。";
    return "";
  }

  const items = normalizeFormTransportItems(form.transportItems);
  const labels = transportFieldLabels(form.transportType);
  if (!items.length) return `请至少录入一条${transportItemsTitle(form.transportType)}。`;
  for (const [index, item] of items.entries()) {
    const rowNo = `第 ${index + 1} 行`;
    if (showContainerManagementFields(form.transportType) && !item.containerNo) return `请填写${rowNo}${labels.containerNo}。`;
    if (showContainerManagementFields(form.transportType) && !CONTAINER_TYPE_OPTIONS.includes(item.containerType || "")) return `请选择${rowNo}柜型。`;
    if (!item.truckPlateNo) return `请填写${rowNo}${labels.truckPlateNo}。`;
    if (!item.departureDate) return `请填写${rowNo}${labels.departureDate}。`;
    if (!item.departurePlace) return `请填写${rowNo}${labels.departurePlace}。`;
    if (!item.arrivalPlace) return `请填写${rowNo}${labels.arrivalPlace}。`;
    if (!item.cargoName) return `请填写${rowNo}${labels.cargoName}。`;
  }
  return "";
}
