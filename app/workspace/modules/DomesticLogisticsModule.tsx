"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, PaginationBar, useConfirmationDialog } from "../components";
import { formatDate, formatDateTime } from "../formatters";
import { LogisticsExpenseForm, LogisticsFeesModule } from "./LogisticsFeesModule";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission, customerDisplayName, customerLegalName, isPdfFile } from "../utils";

type TransportItem = {
  id?: string;
  containerNo?: string;
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
  remarkTextManualEdited?: boolean;
  remarkText?: string;
  exportInvoiceRemark?: string;
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
  submittedAt?: string | null;
  domesticLogisticsInfo?: DomesticLogisticsInfo | null;
  documents?: DomesticLogisticsDocument[];
  logisticsSuppliers?: Array<{ id: string; supplierName?: string; name?: string; supplierType?: string }>;
};

type DomesticLogisticsResponse = {
  rows: DomesticLogisticsRow[];
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

const PAGE_SIZE = 20;
const TRANSPORT_TYPES = [
  { value: "TRUCK", label: "车辆运输" },
  { value: "EXPRESS", label: "快递运输" },
  { value: "MULTIMODAL", label: "多式联运" },
];
const CUSTOMS_DOCUMENT_TYPES = [
  { value: "CUSTOMS_ENTRY_FORM", label: "报关单" },
  { value: "RELEASE_NOTICE", label: "放行通知书" },
  { value: "CUSTOMS_POWER_OF_ATTORNEY", label: "报关委托书" },
];
const ARCHIVE_SCOPE_OPTIONS = [
  { value: "current", label: "当前业务" },
  { value: "archive", label: "已归档业务" },
  { value: "all", label: "全部业务" },
];

function emptyTransportItem(): TransportItem {
  return {
    containerNo: "",
    truckPlateNo: "",
    trailerPlateNo: "",
    departureDate: "",
    departurePlace: "",
    arrivalPlace: "",
    cargoName: "",
    remark: "",
  };
}

export function DomesticLogisticsModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOpenToken?: number;
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
  const [editingOrderId, setEditingOrderId] = useState("");
  const [feeEntryOrderId, setFeeEntryOrderId] = useState("");
  const [expenseRefreshToken, setExpenseRefreshToken] = useState(0);
  const [uploadingKey, setUploadingKey] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canDeleteDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员"]);
  const canEditDomesticLogistics = canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员", "物流供应商", "物流资料录入员"]);
  const canUploadCustomsDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "业务员", "物流供应商", "物流资料录入员"])
    && canWritePermission(currentUser, permissions, "domesticLogistics", ["管理员", "业务员", "物流供应商", "物流资料录入员"]);
  const canDeleteCustomsDocuments = false;
  const canCreateLogisticsExpense = canWritePermission(currentUser, permissions, "logistics", ["管理员", "物流供应商"]);

  async function loadRows(nextKeyword = submittedKeyword, nextBusinessScope = businessScope) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ businessScope: nextBusinessScope });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<DomesticLogisticsResponse>(`/api/domestic-logistics?${params}`);
      const nextRows = Array.isArray(result.rows) ? result.rows : [];
      setRows(nextRows);
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取国内物流信息失败");
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

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, page]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setFeeEntryOrderId("");
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
    setNotice("");
    void loadRows("", "current");
  }

  function changeBusinessScope(nextBusinessScope: string) {
    setBusinessScope(nextBusinessScope);
    setPage(1);
    setExpandedId("");
    setEditingOrderId("");
    setFeeEntryOrderId("");
    setNotice("");
    void loadRows(submittedKeyword, nextBusinessScope);
  }

  async function uploadDocument(orderId: string, documentType: string, file: File | null) {
    if (!file) return;
    setUploadingKey(`${orderId}:${documentType}`);
    setError("");
    setNotice("");
    try {
      if (!isPdfFile(file)) {
        throw new Error("只能上传 PDF 文件");
      }
      const formData = new FormData();
      formData.append("orderId", orderId);
      formData.append("documentType", documentType);
      formData.append("uploadSource", "REACT_DOMESTIC_LOGISTICS");
      formData.append("file", file);
      const response = await fetch("/api/order-documents", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success !== true) {
        throw new Error(typeof data?.message === "string" ? data.message : "文件上传失败");
      }
      await loadRows(submittedKeyword, businessScope);
      setNotice("报关资料已上传");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    } finally {
      setUploadingKey("");
    }
  }

  async function deleteDocument(document: DomesticLogisticsDocument) {
    const confirmationResult = await requestConfirmation({
      title: "确认删除文件？",
      message: "删除后该文件不会继续显示在报关资料中。",
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
      if (result.success !== true) throw new Error(result.message || "删除文件失败");
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || "报关资料已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除文件失败");
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function deleteDomesticLogistics(row: DomesticLogisticsRow) {
    const id = row.domesticLogisticsInfo?.id;
    if (!id) return;
    const confirmationResult = await requestConfirmation({
      title: "确认删除该国内物流信息？",
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
      if (result.success !== true) throw new Error(result.message || "删除国内物流信息失败");
      setExpandedId("");
      setEditingOrderId("");
      setFeeEntryOrderId("");
      await loadRows(submittedKeyword, businessScope);
      setNotice(result.message || "国内物流信息已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除国内物流信息失败");
    }
  }

  return (
    <>
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>业务模块</span>
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

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 提单号 / 客户 / 到达地 / 货物"
        />
        <select value={businessScope} onChange={(event) => changeBusinessScope(event.target.value)} disabled={loading}>
          {ARCHIVE_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户简称</th>
              <th>到达地</th>
              <th>运输货物名称</th>
              <th>物流状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>数据加载中...</div></td>
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
                onOpenFeeEntry={() => {
                  setExpandedId(row.id);
                  setEditingOrderId("");
                  setFeeEntryOrderId((current) => current === row.id ? "" : row.id);
                }}
                onCloseFeeEntry={() => setFeeEntryOrderId("")}
                onSaved={() => {
                  setNotice(feeEntryOrderId === row.id ? "物流费用已提交" : "国内物流信息已保存");
                  setEditingOrderId("");
                  setFeeEntryOrderId("");
                  setExpenseRefreshToken((current) => current + 1);
                  void loadRows(submittedKeyword, businessScope);
                }}
                onCancelEdit={() => setEditingOrderId("")}
                canDeleteDomesticLogistics={canDeleteDomesticLogistics}
                onDeleteDomesticLogistics={() => void deleteDomesticLogistics(row)}
                uploadingKey={uploadingKey}
                deletingDocumentId={deletingDocumentId}
                onUploadDocument={uploadDocument}
                onDeleteDocument={deleteDocument}
              />
            )) : (
              <tr>
                <td colSpan={6}><div className={styles.emptyState}>未找到匹配的国内物流订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={rows.length} page={page} totalPages={totalPages} onPage={setPage} />
    </section>
    <LogisticsFeesModule
      embedded
      refreshToken={expenseRefreshToken}
      currentUserRole={currentUser.role}
      currentUserSupplierId={currentUser.supplierId || ""}
      canCreateExpense={canCreateLogisticsExpense}
    />
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
  onOpenFeeEntry,
  onCloseFeeEntry,
  onSaved,
  onCancelEdit,
  canDeleteDomesticLogistics,
  onDeleteDomesticLogistics,
  uploadingKey,
  deletingDocumentId,
  onUploadDocument,
  onDeleteDocument,
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
  onOpenFeeEntry: () => void;
  onCloseFeeEntry: () => void;
  onSaved: () => void;
  onCancelEdit: () => void;
  canDeleteDomesticLogistics: boolean;
  onDeleteDomesticLogistics: () => void;
  uploadingKey: string;
  deletingDocumentId: string;
  onUploadDocument: (orderId: string, documentType: string, file: File | null) => void;
  onDeleteDocument: (document: DomesticLogisticsDocument) => void;
}) {
  const info = row.domesticLogisticsInfo;
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{row.orderNo || "-"}</strong></td>
        <td title={customerLegalName(row)}>{customerDisplayName(row)}</td>
        <td>{info?.destinationPlace || firstItemValue(info, "arrivalPlace") || "-"}</td>
        <td>{info?.cargoDescription || firstItemValue(info, "cargoName") || "-"}</td>
        <td><span className={`${styles.statusPill} ${row.logisticsStatus === "已提交" ? styles.statusSuccess : styles.statusWarning}`}>{row.logisticsStatus || "未提交"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={6}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                {canCreateLogisticsExpense ? (
                  <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenFeeEntry(); }}>
                    录入费用
                  </button>
                ) : null}
                {canEditDomesticLogistics ? (
                  <button className={styles.primaryButtonCompact} type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>
                    {info ? "编辑物流信息" : "录入物流信息"}
                  </button>
                ) : null}
                {canDeleteDomesticLogistics && info?.id ? (
                  <button className={styles.dangerButton} type="button" onClick={(event) => { event.stopPropagation(); onDeleteDomesticLogistics(); }}>
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
                <DetailField label="出口发票备注" value={info?.exportInvoiceRemark || info?.remarkText || "暂无出口发票备注"} wide />
              </div>
              {info?.transportItems?.length ? (
                <div className={styles.subList}>
                  <strong>集装箱运输明细</strong>
                  {info.transportItems.map((item, index) => (
                    <div className={styles.subListItem} key={`${item.containerNo || item.truckPlateNo || index}-${index}`}>
                      <strong>明细 {index + 1}{item.containerNo ? ` · ${item.containerNo}` : ""}</strong>
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
              <CustomsDocumentPanel
                orderId={row.id}
                documents={row.documents || []}
                uploadingKey={uploadingKey}
                deletingDocumentId={deletingDocumentId}
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
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();

  function setFormValue<K extends keyof DomesticLogisticsForm>(key: K, value: DomesticLogisticsForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key !== "remarkText" && next.remarkTextManualEdited !== true) {
        next.remarkText = generateRemark(next);
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
      if (!next.remarkTextManualEdited) next.remarkText = generateRemark(next);
      return next;
    });
  }

  function addItem(copyPrevious = false) {
    setForm((current) => {
      const previous = current.transportItems[current.transportItems.length - 1] || emptyTransportItem();
      const transportItems = [...current.transportItems, copyPrevious ? { ...previous, containerNo: "" } : emptyTransportItem()];
      const next = { ...current, transportItems };
      if (!next.remarkTextManualEdited) next.remarkText = generateRemark(next);
      return next;
    });
  }

  function removeItem(index: number) {
    setForm((current) => {
      const transportItems = current.transportItems.filter((_, itemIndex) => itemIndex !== index);
      const next = { ...current, transportItems: transportItems.length ? transportItems : [emptyTransportItem()] };
      if (!next.remarkTextManualEdited) next.remarkText = generateRemark(next);
      return next;
    });
  }

  async function regenerateRemark() {
    if (form.remarkTextManualEdited) {
      const confirmationResult = await requestConfirmation({
        title: "重新生成出口发票备注？",
        message: "当前备注已手工修改，重新生成将覆盖现有内容。",
        confirmLabel: "重新生成",
        cancelLabel: "取消",
        variant: "warning",
      });
      if (!confirmationResult.confirmed) return;
    }
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
      const remarkText = form.remarkTextManualEdited ? form.remarkText.trim() : generateRemark({ ...form, transportItems });
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
          remarkTextManualEdited: form.remarkTextManualEdited,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "国内物流信息保存失败");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "国内物流信息保存失败");
    } finally {
      setSaving(false);
    }
  }

  const isExpress = form.transportType === "EXPRESS";

  return (
    <>
    <form className={styles.inlineEditPanel} onSubmit={submitForm} onClick={(event) => event.stopPropagation()}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>录入国内物流信息 - {row.orderNo || "-"}</strong>
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
            <strong>集装箱运输明细</strong>
            <div>
              <button className={styles.secondaryButton} type="button" onClick={() => addItem(false)}>添加集装箱/车辆</button>
              <button className={styles.secondaryButton} type="button" onClick={() => addItem(true)}>复制上一行</button>
            </div>
          </div>
          <div className={styles.transportItemsGrid}>
            {form.transportItems.map((item, index) => (
              <div className={styles.transportItemCard} key={`transport-item-${index}`}>
                <strong>第 {index + 1} 行</strong>
                <label>集装箱号<input value={item.containerNo || ""} onChange={(event) => updateItem(index, "containerNo", event.target.value)} /></label>
                <label>{form.transportType === "MULTIMODAL" ? "首程车牌号" : "车牌号"}<input value={item.truckPlateNo || ""} onChange={(event) => updateItem(index, "truckPlateNo", event.target.value)} required /></label>
                <label>挂车车牌<input value={item.trailerPlateNo || ""} onChange={(event) => updateItem(index, "trailerPlateNo", event.target.value)} /></label>
                <label>起运日期<input type="date" value={item.departureDate || ""} onChange={(event) => updateItem(index, "departureDate", event.target.value)} required /></label>
                <label>{form.transportType === "MULTIMODAL" ? "首程起运地" : "起运地"}<input value={item.departurePlace || ""} onChange={(event) => updateItem(index, "departurePlace", event.target.value)} required /></label>
                <label>到达地<input value={item.arrivalPlace || ""} onChange={(event) => updateItem(index, "arrivalPlace", event.target.value)} required /></label>
                <label>运输货物名称<input value={item.cargoName || ""} onChange={(event) => updateItem(index, "cargoName", event.target.value)} required /></label>
                <label>备注<input value={item.remark || ""} onChange={(event) => updateItem(index, "remark", event.target.value)} /></label>
                <button className={styles.secondaryButton} type="button" onClick={() => removeItem(index)}>删除本行</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <label className={styles.remarkCard}>
        <span>出口发票备注</span>
        <textarea
          value={form.remarkText}
          onChange={(event) => setForm((current) => ({ ...current, remarkText: event.target.value, remarkTextManualEdited: true }))}
          rows={7}
        />
        <small className={styles.mutedText}>{form.remarkTextManualEdited ? "已手工修改，不再自动覆盖。" : "字段变更后将自动更新备注。"}</small>
        <button className={styles.secondaryButton} type="button" onClick={() => void regenerateRemark()}>重新生成备注</button>
      </label>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "提交中..." : "提交国内物流信息"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
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

function CustomsDocumentPanel({
  orderId,
  documents,
  uploadingKey,
  deletingDocumentId,
  canUpload,
  canDelete,
  onUpload,
  onDelete,
}: {
  orderId: string;
  documents: DomesticLogisticsDocument[];
  uploadingKey: string;
  deletingDocumentId: string;
  canUpload: boolean;
  canDelete: boolean;
  onUpload: (orderId: string, documentType: string, file: File | null) => void;
  onDelete: (document: DomesticLogisticsDocument) => void;
}) {
  return (
    <div className={styles.documentGroupCard}>
      <strong>报关资料上传</strong>
      {CUSTOMS_DOCUMENT_TYPES.map((documentType) => {
        const matchedDocuments = documents.filter((document) => (
          document.documentType === documentType.value && document.uploadStatus === "SUCCESS"
        ));
        const uploading = uploadingKey === `${orderId}:${documentType.value}`;
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
                <label className={styles.secondaryButton}>
                  {uploading ? "上传中..." : (matchedDocuments.length ? "替换/上传新版PDF" : "选择PDF文件")}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={uploading}
                    hidden
                    onChange={(event) => {
                      onUpload(orderId, documentType.value, event.target.files?.[0] || null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              ) : null}
              {matchedDocuments.map((document) => (
                <span key={document.id} className={styles.fileListItemActions}>
                  <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/preview`} target="_blank" rel="noreferrer">预览</a>
                  <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
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

function firstItemValue(info: DomesticLogisticsInfo | null | undefined, key: keyof TransportItem) {
  return info?.transportItems?.find((item) => item[key])?.[key] || "";
}

function expenseOrderFromDomesticRow(row: DomesticLogisticsRow) {
  const info = row.domesticLogisticsInfo;
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
    remarkText: info?.exportInvoiceRemark || info?.remarkText || "",
    remarkTextManualEdited: Boolean(info?.remarkTextManualEdited),
    transportItems,
  };
  return { ...form, remarkText: form.remarkText || generateRemark(form) };
}

function generateRemark(form: DomesticLogisticsForm) {
  if (form.transportType === "EXPRESS") {
    return [
      form.expressTrackingNo ? `快递单号：${form.expressTrackingNo}` : "",
      form.destinationPlace ? `到达地：${form.destinationPlace}` : "",
      form.cargoDescription ? `运输货物名称：${form.cargoDescription}` : "",
    ].filter(Boolean).join("\n");
  }
  return form.transportItems.map((item) => [
    item.containerNo ? `集装箱号：${item.containerNo}` : "",
    item.truckPlateNo ? `车牌号：${item.truckPlateNo}` : "",
    item.trailerPlateNo ? `挂车车牌：${item.trailerPlateNo}` : "",
    item.departureDate ? `起运日：${item.departureDate}` : "",
    item.departurePlace ? `起运地：${item.departurePlace}` : "",
    item.arrivalPlace ? `到达地：${item.arrivalPlace}` : "",
    item.cargoName ? `运输货物名称：${item.cargoName}` : "",
  ].filter(Boolean).join("\n")).filter(Boolean).join("\n\n");
}

function normalizeFormTransportItems(items: TransportItem[]) {
  return items.map((item) => ({
    containerNo: (item.containerNo || "").trim(),
    truckPlateNo: (item.truckPlateNo || "").trim(),
    trailerPlateNo: (item.trailerPlateNo || "").trim(),
    departureDate: (item.departureDate || "").trim(),
    departurePlace: (item.departurePlace || "").trim(),
    arrivalPlace: (item.arrivalPlace || "").trim(),
    cargoName: (item.cargoName || "").trim(),
    remark: (item.remark || "").trim(),
  }));
}

function validateDomesticLogisticsForm(form: DomesticLogisticsForm) {
  if (form.transportType === "EXPRESS") {
    if (!form.expressTrackingNo.trim()) return "请填写快递单号。";
    if (!form.destinationPlace.trim()) return "请填写到达地。";
    if (!form.cargoDescription.trim()) return "请填写运输货物名称。";
    return "";
  }

  const items = normalizeFormTransportItems(form.transportItems);
  if (!items.length) return "请至少录入一条集装箱运输明细。";
  for (const [index, item] of items.entries()) {
    const rowNo = `第 ${index + 1} 行`;
    if (!item.truckPlateNo) return `请填写${rowNo}${form.transportType === "MULTIMODAL" ? "首程车牌号" : "车牌号"}。`;
    if (!item.departureDate) return `请填写${rowNo}起运日期。`;
    if (!item.departurePlace) return `请填写${rowNo}${form.transportType === "MULTIMODAL" ? "首程起运地" : "起运地"}。`;
    if (!item.arrivalPlace) return `请填写${rowNo}到达地。`;
    if (!item.cargoName) return `请填写${rowNo}运输货物名称。`;
  }
  return "";
}
