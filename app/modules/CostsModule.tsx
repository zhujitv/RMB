"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, PaginationBar, UiCheckbox, useConfirmationDialog } from "../components";
import { moneyText } from "../formatters";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission, uploadFormDataWithProgress, validatePaymentVoucherUploadFile, validatePdfUploadFile } from "../utils";
import styles from "../WorkspaceShell.module.css";
import { CostDocumentsDrawer, PaymentVoucherPreviewModal } from "./costs/documents-drawer";
import { CostDetailDrawer, CostInvoiceGroupDrawer, CostOrderSummaryDrawer } from "./costs/detail-drawers";
import { CostFormDrawer } from "./costs/cost-form-drawer";
import { CostDetailTableHead, CostInvoiceGroupRows, CostInvoiceGroupTableHead, CostOrderSummaryRows, CostOrderTableHead, CostTableRows, costViewColSpan, costViewLabel, recalculateOrderSummary } from "./costs/cost-table";
import { costSupplierName, costUploadKey, hasPaymentVoucher, isProductSupplierPaymentEnabled, paymentVoucherUploadKey } from "./costs/helpers";
import { COST_CONFIRMATION_OPTIONS, COST_FILTER_TYPE_LABELS, COST_FILTER_TYPES, COST_INVOICE_STATUSES, COST_PAYMENT_STATUSES, PAGE_SIZE, emptyCostFilters, type CostDeleteResponse, type CostDetailResponse, type CostDocument, type CostFilters, type CostFormDrawerState, type CostInvoiceGroupRow, type CostOrderSummary, type CostPaymentResponse, type CostRow, type CostsResponse, type CostView } from "./costs/model";
import { logisticsCostTypeLabel } from "../../lib/platform/logistics-cost-types";

export function CostsModule({
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
  const [rows, setRows] = useState<CostRow[]>([]);
  const [orderRows, setOrderRows] = useState<CostOrderSummary[]>([]);
  const [invoiceGroupRows, setInvoiceGroupRows] = useState<CostInvoiceGroupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CostFilters>({ ...emptyCostFilters });
  const [submittedFilters, setSubmittedFilters] = useState<CostFilters>({ ...emptyCostFilters });
  const [costView, setCostView] = useState<CostView>("invoiceGroups");
  const [archiveScope, setArchiveScope] = useState("current");
  const [detailCost, setDetailCost] = useState<CostRow | null>(null);
  const [detailOrderSummary, setDetailOrderSummary] = useState<CostOrderSummary | null>(null);
  const [detailInvoiceGroup, setDetailInvoiceGroup] = useState<CostInvoiceGroupRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [costFormDrawer, setCostFormDrawer] = useState<CostFormDrawerState | null>(null);
  const [documentCost, setDocumentCost] = useState<CostRow | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [paymentSavingId, setPaymentSavingId] = useState("");
  const [voucherUploadingKey, setVoucherUploadingKey] = useState("");
  const [voucherPreviewCost, setVoucherPreviewCost] = useState<CostRow | null>(null);
  const [uploadProgressByKey, setUploadProgressByKey] = useState<Record<string, number>>({});
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "财务", "业务员"]);
  const canManageFactoryPayments = ["管理员", "财务"].includes(currentUser.role);

  function openCreateCostDrawer() {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setDocumentCost(null);
    setCostFormDrawer({ mode: "create", cost: null });
  }

  function openEditCostDrawer(cost: CostRow) {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setDocumentCost(null);
    setCostFormDrawer({ mode: "edit", cost });
  }

  function openPaymentVoucherPreview(cost: CostRow) {
    if (!hasPaymentVoucher(cost)) return;
    setVoucherPreviewCost(cost);
  }

  function closeCostFormDrawer() {
    setCostFormDrawer(null);
  }

  async function loadCosts(
    nextPage = page,
    nextFilters = submittedFilters,
    nextArchiveScope = archiveScope,
    nextView: CostView = costView,
  ) {
    setLoading(true);
    setError("");
    try {
      const effectiveFilters = nextView === "invoiceExceptions"
        ? { ...nextFilters, invoiceStatus: "未收到" }
        : nextFilters;
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        archiveScope: nextArchiveScope,
        view: nextView,
      });
      if (effectiveFilters.keyword.trim()) params.set("keyword", effectiveFilters.keyword.trim());
      Object.entries(effectiveFilters).forEach(([key, value]) => {
        if (key === "keyword") return;
        const text = String(value || "").trim();
        if (text) params.set(key, text);
      });
      const result = await apiJson<CostsResponse>(`/api/costs?${params}`);
      const data = result.data || { rows: result.costs || [], total: result.costs?.length || 0, page: nextPage, pageSize: PAGE_SIZE };
      if (nextView === "orders") {
        setOrderRows(Array.isArray(data.rows) ? (data.rows as CostOrderSummary[]) : []);
        setRows([]);
        setInvoiceGroupRows([]);
      } else if (nextView === "invoiceGroups" || nextView === "invoiceExceptions") {
        setInvoiceGroupRows(Array.isArray(data.rows) ? (data.rows as CostInvoiceGroupRow[]) : []);
        setRows([]);
        setOrderRows([]);
      } else {
        setRows(Array.isArray(data.rows) ? (data.rows as CostRow[]) : []);
        setOrderRows([]);
        setInvoiceGroupRows([]);
      }
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取成本数据失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    const nextFilters = { ...emptyCostFilters, keyword: value };
    setFilters(nextFilters);
    setSubmittedFilters(nextFilters);
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, nextFilters, archiveScope, "invoiceGroups");
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    void loadCosts(1, { ...emptyCostFilters });
  }, []);

  useEffect(() => {
    const value = filters.keyword.trim();
    if (value === submittedFilters.keyword) return;
    const timer = window.setTimeout(() => {
      const nextFilters = Object.fromEntries(
        Object.entries(filters).map(([key, filterValue]) => [
          key,
          key === "keyword" ? value : String(filterValue || "").trim(),
        ]),
      ) as CostFilters;
      setSubmittedFilters(nextFilters);
      setDetailCost(null);
      setDetailOrderSummary(null);
      setDetailInvoiceGroup(null);
      setCostFormDrawer(null);
      setNotice("");
      void loadCosts(1, nextFilters, archiveScope, costView);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    filters.keyword,
    filters.costType,
    filters.paymentStatus,
    filters.costConfirmed,
    filters.invoiceStatus,
    filters.dateFrom,
    filters.dateTo,
    submittedFilters.keyword,
    archiveScope,
    costView,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeRows = costView === "orders" ? orderRows : (costView === "invoiceGroups" || costView === "invoiceExceptions" ? invoiceGroupRows : rows);

  function setFilter<K extends keyof CostFilters>(key: K, value: CostFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function submitSearch() {
    const nextFilters = Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [key, String(value || "").trim()]),
    ) as CostFilters;
    setSubmittedFilters(nextFilters);
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, nextFilters, archiveScope, costView);
  }

  function resetSearch() {
    setFilters({ ...emptyCostFilters });
    setSubmittedFilters({ ...emptyCostFilters });
    setArchiveScope("current");
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, { ...emptyCostFilters }, "current", costView);
  }

  function gotoPage(nextPage: number) {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    void loadCosts(nextPage, submittedFilters, archiveScope, costView);
  }

  function changeArchiveScope(nextArchiveScope: string) {
    setArchiveScope(nextArchiveScope);
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, submittedFilters, nextArchiveScope, costView);
  }

  function changeCostView(nextView: CostView) {
    const nextFilters = nextView === "invoiceExceptions"
      ? { ...submittedFilters, invoiceStatus: "未收到" }
      : submittedFilters;
    if (nextView === "invoiceExceptions") {
      setFilters((current) => ({ ...current, invoiceStatus: "未收到" }));
      setSubmittedFilters(nextFilters);
    }
    setCostView(nextView);
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, nextFilters, archiveScope, nextView);
  }

  return (
    <div className={styles.costPage}>
    <section className={`${styles.moduleCard} ${styles.costContent}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>成本管理</h2>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.primaryButtonCompact}
            type="button"
            onClick={openCreateCostDrawer}
          >
            登记成本
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadCosts(page, submittedFilters, archiveScope, costView);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      <div className={styles.listToolbar}>
        <button
          className={costView === "invoiceGroups" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => changeCostView("invoiceGroups")}
        >
          发票组 / Shipment 组
        </button>
        <button
          className={costView === "orders" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => changeCostView("orders")}
        >
          按订单 / Shipment 汇总
        </button>
        <button
          className={costView === "invoiceExceptions" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => changeCostView("invoiceExceptions")}
        >
          发票异常清单
        </button>
      </div>

      <div className={styles.costFilterPanel}>
        <div className={styles.costFilterSearchRow}>
          <label>
            关键词
            <input
              value={filters.keyword}
              onChange={(event) => setFilter("keyword", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSearch();
              }}
              placeholder="搜索订单号 / 客户简称 / 客户全称 / 成本类型 / 供应商 / 备注"
            />
          </label>
          <label>
            业务范围
            <select value={archiveScope} onChange={(event) => changeArchiveScope(event.target.value)} disabled={loading}>
              <option value="current">当前业务</option>
              <option value="archive">已归档业务</option>
              <option value="all">全部业务</option>
            </select>
          </label>
        </div>

        <div className={styles.costFilterPrimaryRow}>
          <label>
            成本类型
            <select value={filters.costType} onChange={(event) => setFilter("costType", event.target.value)}>
              <option value="">全部成本类型</option>
              {COST_FILTER_TYPES.map((type) => (
                <option key={type} value={type}>{COST_FILTER_TYPE_LABELS[type] || type}</option>
              ))}
            </select>
          </label>
          <label>
            付款状态
            <select value={filters.paymentStatus} onChange={(event) => setFilter("paymentStatus", event.target.value)}>
              <option value="">全部付款状态</option>
              {COST_PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <div className={styles.costFilterActions}>
            <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
            <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
          </div>
        </div>

        <div className={styles.costFilterSecondaryRow}>
          <label>
            成本确认
            <select value={filters.costConfirmed} onChange={(event) => setFilter("costConfirmed", event.target.value)}>
              <option value="">全部确认状态</option>
              {COST_CONFIRMATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            发票状态
            <select value={costView === "invoiceExceptions" ? "未收到" : filters.invoiceStatus} onChange={(event) => setFilter("invoiceStatus", event.target.value)} disabled={costView === "invoiceExceptions"}>
              <option value="">全部发票状态</option>
              {COST_INVOICE_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </label>
          <label>
            开始日期
            <input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} />
          </label>
          <label>
            结束日期
            <input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} />
          </label>
        </div>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      {/*
        重要：成本管理主列表按订单 / shipment 聚合展示。
        费用明细只在订单详情抽屉中展示，避免一票业务在主列表被拆成多行。
      */}
      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols} ${styles.costTableWrap}`}>
        <table className={styles.dataTable}>
          {costView === "orders" ? <CostOrderTableHead /> : costView === "invoiceGroups" || costView === "invoiceExceptions" ? <CostInvoiceGroupTableHead showException={costView === "invoiceExceptions"} /> : <CostDetailTableHead />}
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={costViewColSpan(costView)}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : activeRows.length ? (costView === "orders"
              ? orderRows.map((order) => (
                <CostOrderSummaryRows
                  key={order.id}
                  order={order}
                  onViewDetail={() => setDetailOrderSummary(order)}
                />
              ))
              : costView === "invoiceGroups" || costView === "invoiceExceptions"
                ? invoiceGroupRows.map((group) => (
                  <CostInvoiceGroupRows
                    key={group.id}
                    group={group}
                    showException={costView === "invoiceExceptions"}
                    onViewDetail={() => setDetailInvoiceGroup(group)}
                    onOpenDocuments={() => openInvoiceGroupDocuments(group)}
                    onOpenPaymentVoucher={openPaymentVoucherPreview}
                  />
                ))
              : rows.map((cost) => (
                <CostTableRows
                  key={cost.id}
                  cost={cost}
                  onViewDetail={() => setDetailCost(cost)}
                  deleting={deletingId === cost.id}
                  onEdit={() => openEditCostDrawer(cost)}
                  onDelete={() => void deleteCost(cost)}
                  onOpenDocuments={() => void openCostDocuments(cost.id)}
                  onOpenPaymentVoucher={openPaymentVoucherPreview}
                />
              ))
            ) : (
              <tr>
                <td colSpan={costViewColSpan(costView)}><div className={styles.emptyState}>未找到匹配的{costViewLabel(costView)}</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={gotoPage} />
      {detailCost ? (
        <CostDetailDrawer
          cost={detailCost}
          deleting={deletingId === detailCost.id}
          onOpenDocuments={() => void openCostDocuments(detailCost.id)}
          onOpenPaymentVoucher={openPaymentVoucherPreview}
          onEdit={() => openEditCostDrawer(detailCost)}
          onDelete={() => void deleteCost(detailCost)}
          onClose={() => setDetailCost(null)}
        />
      ) : null}
      {costFormDrawer ? (
        <CostFormDrawer
          drawer={costFormDrawer}
          canManageFactoryPayments={canManageFactoryPayments}
          onCancel={closeCostFormDrawer}
          onSaved={async () => {
            const savedDrawer = costFormDrawer;
            setCostFormDrawer(null);
            setDetailCost(null);
            setDetailOrderSummary(null);
            if (savedDrawer.mode === "edit" && savedDrawer.cost?.id) {
              await fetchCostDetail(savedDrawer.cost.id);
              setNotice("成本已更新");
              return;
            }
            await loadCosts(page, submittedFilters, archiveScope, costView);
            setNotice("成本已保存");
          }}
        />
      ) : null}
      {detailOrderSummary ? (
        <CostOrderSummaryDrawer
          order={detailOrderSummary}
          onOpenDocuments={(costId) => void openCostDocuments(costId)}
          onOpenPaymentVoucher={openPaymentVoucherPreview}
          deletingId={deletingId}
          onDelete={(cost) => void deleteCost(cost)}
          onClose={() => setDetailOrderSummary(null)}
        />
      ) : null}
      {detailInvoiceGroup ? (
        <CostInvoiceGroupDrawer
          group={detailInvoiceGroup}
          onOpenDocuments={(costId) => void openCostDocuments(costId)}
          onOpenPaymentVoucher={openPaymentVoucherPreview}
          onClose={() => setDetailInvoiceGroup(null)}
        />
      ) : null}

      {documentCost ? (
        <CostDocumentsDrawer
          cost={documentCost}
          loading={documentLoading}
          error={documentError}
          uploadingKey={uploadingKey}
          uploadProgressByKey={uploadProgressByKey}
          deletingDocumentId={deletingDocumentId}
          canWriteDocuments={canWriteDocuments}
          canManageFactoryPayments={canManageFactoryPayments}
          paymentSavingId={paymentSavingId}
          voucherUploadingKey={voucherUploadingKey}
          onClose={() => {
            setDocumentCost(null);
            setDocumentError("");
            setUploadingKey("");
            setPaymentSavingId("");
            setVoucherUploadingKey("");
            setDeletingDocumentId("");
          }}
          onUpload={(cost, documentType, file) => void uploadCostDocument(cost, documentType, file)}
          onUpdatePayment={(cost, paid, paidAt) => void updateProductSupplierCostPayment(cost, paid, paidAt)}
          onUploadPaymentVoucher={(cost, file) => void uploadPaymentVoucher(cost, file)}
          onOpenPaymentVoucher={openPaymentVoucherPreview}
          onDelete={(cost, document) => void deleteCostDocument(cost, document)}
        />
      ) : null}
      {voucherPreviewCost ? (
        <PaymentVoucherPreviewModal
          cost={voucherPreviewCost}
          onClose={() => setVoucherPreviewCost(null)}
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
    </section>
    </div>
  );

  async function fetchCostDetail(id: string) {
    const result = await apiJson<CostDetailResponse>(`/api/costs/${encodeURIComponent(id)}`);
    const cost = result.cost || result.data?.cost;
    if (!cost) throw new Error(result.message || "未找到成本详情");
    setRows((current) => current.map((item) => item.id === cost.id ? { ...item, ...cost } : item));
    setDetailCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setDocumentCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setVoucherPreviewCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setCostFormDrawer((current) => current?.cost?.id === cost.id ? { ...current, cost: { ...current.cost, ...cost } } : current);
    return cost;
  }

  async function openCostDocuments(id: string) {
    const cached = rows.find((cost) => cost.id === id) || null;
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDetailInvoiceGroup(null);
    setCostFormDrawer(null);
    setDocumentCost(cached);
    setDocumentLoading(true);
    setDocumentError("");
    try {
      const cost = await fetchCostDetail(id);
      setDocumentCost(cost);
    } catch (detailError) {
      setDocumentError(detailError instanceof Error ? detailError.message : "读取成本资料失败");
    } finally {
      setDocumentLoading(false);
    }
  }

  function openInvoiceGroupDocuments(group: CostInvoiceGroupRow) {
    if (group.groupType === "LOGISTICS_BILL" || (group.costs || []).length !== 1) {
      setDetailCost(null);
      setDetailOrderSummary(null);
      setCostFormDrawer(null);
      setDocumentCost(null);
      setDetailInvoiceGroup(group);
      return;
    }
    const costId = group.costs?.[0]?.id;
    if (costId) void openCostDocuments(costId);
  }

  async function refreshDocumentCost(costId: string) {
    try {
      const freshCost = await fetchCostDetail(costId);
      setDocumentCost(freshCost);
    } catch (detailError) {
      setDocumentError(detailError instanceof Error ? detailError.message : "刷新成本资料失败");
    }
  }

  async function uploadCostDocument(cost: CostRow, documentType: string, file: File | null) {
    if (!file) return;
    const validationError = validatePdfUploadFile(file);
    if (validationError) {
      setDocumentError(validationError);
      return;
    }
    if (!cost.orderId) {
      setDocumentError("该成本未关联订单，不能上传资料。");
      return;
    }
    if (!cost.supplierId) {
      setDocumentError("该成本未关联供应商，不能上传供应商资料。");
      return;
    }
    const key = costUploadKey(cost, documentType);
    setUploadingKey(key);
    setUploadProgressByKey((current) => ({ ...current, [key]: 0 }));
    setDocumentError("");
    try {
      const formData = new FormData();
      formData.append("orderId", cost.orderId);
      formData.append("documentType", documentType);
      formData.append("costId", cost.id);
      formData.append("supplierId", cost.supplierId);
      formData.append("relatedModule", "SUPPLIER");
      formData.append("uploadSource", "REACT_COSTS");
      formData.append("file", file);
      await uploadFormDataWithProgress("/api/order-documents", formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [key]: progress }));
      });
      await refreshDocumentCost(cost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") await loadCosts(page, submittedFilters, archiveScope, costView);
      setNotice("上传成功");
    } catch (uploadError) {
      setDocumentError(uploadError instanceof Error ? uploadError.message : "资料上传失败");
    } finally {
      setUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function updateProductSupplierCostPayment(cost: CostRow, paid: boolean, paidAt: string) {
    if (!isProductSupplierPaymentEnabled(cost)) {
      setDocumentError("付款信息仅适用于产品供应商货款。");
      return;
    }
    if (!canManageFactoryPayments) {
      setDocumentError("只有管理员或财务可以维护产品供应商货款付款信息。");
      return;
    }
    if (!paid) {
      const confirmationResult = await requestConfirmation({
        title: "取消付款状态",
        message: "确认取消该产品供应商货款的已付款状态吗？",
        details: [`供应商：${costSupplierName(cost)}`, `成本：${moneyText(cost.currency, cost.amount, cost.amountCny)}`],
        confirmLabel: "取消付款",
        cancelLabel: "返回",
        variant: "danger",
      });
      if (!confirmationResult.confirmed) return;
    }
    setPaymentSavingId(cost.id);
    setDocumentError("");
    try {
      const result = await apiJson<CostPaymentResponse>(`/api/costs/${encodeURIComponent(cost.id)}/payment`, {
        method: "PATCH",
        body: JSON.stringify({
          paid,
          paidAt: paid ? paidAt : null,
        }),
      });
      const nextCost = result.cost || result.data?.cost;
      if (!nextCost) throw new Error(result.message || "更新付款信息失败");
      await refreshDocumentCost(nextCost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") await loadCosts(page, submittedFilters, archiveScope, costView);
      setNotice(paid ? "已标记付款" : "已取消付款状态");
    } catch (paymentError) {
      setDocumentError(paymentError instanceof Error ? paymentError.message : "更新付款信息失败");
    } finally {
      setPaymentSavingId("");
    }
  }

  async function uploadPaymentVoucher(cost: CostRow, file: File | null) {
    if (!file) return;
    if (!isProductSupplierPaymentEnabled(cost)) {
      setDocumentError("付款凭证仅适用于产品供应商货款。");
      return;
    }
    if (!canManageFactoryPayments) {
      setDocumentError("只有管理员或财务可以上传产品供应商货款付款凭证。");
      return;
    }
    const validationError = validatePaymentVoucherUploadFile(file);
    if (validationError) {
      setDocumentError(validationError);
      return;
    }
    const key = paymentVoucherUploadKey(cost);
    setVoucherUploadingKey(key);
    setUploadProgressByKey((current) => ({ ...current, [key]: 0 }));
    setDocumentError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await uploadFormDataWithProgress<CostPaymentResponse>(`/api/costs/${encodeURIComponent(cost.id)}/payment-voucher`, formData, (progress) => {
        setUploadProgressByKey((current) => ({ ...current, [key]: progress }));
      });
      const nextCost = result.cost || result.data?.cost;
      if (!nextCost) throw new Error(result.message || "付款凭证上传失败");
      await refreshDocumentCost(nextCost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") await loadCosts(page, submittedFilters, archiveScope, costView);
      setNotice("付款凭证已上传");
    } catch (uploadError) {
      setDocumentError(uploadError instanceof Error ? uploadError.message : "付款凭证上传失败");
    } finally {
      setVoucherUploadingKey("");
      setUploadProgressByKey((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  async function deleteCostDocument(cost: CostRow, document: CostDocument) {
    const confirmationResult = await requestConfirmation({
      title: "确认删除该资料？",
      message: "删除后该文件不会继续参与资料完整度统计。",
      details: [`文件：${document.fileName || "-"}`],
      confirmLabel: "删除资料",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingDocumentId(document.id);
    setDocumentError("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/order-documents/${encodeURIComponent(document.id)}`, {
        method: "DELETE",
      });
      if (result.success === false) throw new Error(result.message || "删除资料失败");
      await refreshDocumentCost(cost.id);
      if (costView === "invoiceGroups" || costView === "invoiceExceptions") await loadCosts(page, submittedFilters, archiveScope, costView);
      setNotice("资料已删除");
    } catch (deleteError) {
      setDocumentError(deleteError instanceof Error ? deleteError.message : "删除资料失败");
    } finally {
      setDeletingDocumentId("");
    }
  }

  function applyDeletedCost(cost: CostRow, orderSummary?: CostOrderSummary | null) {
    const nextOrderSummary = orderSummary || null;
    setRows((current) => current.filter((item) => item.id !== cost.id));
    setOrderRows((current) => {
      if (nextOrderSummary) {
        const exists = current.some((item) => item.id === nextOrderSummary.id || item.orderId === nextOrderSummary.orderId);
        if (!exists) return current;
        return current.map((item) => (
          item.id === nextOrderSummary.id || item.orderId === nextOrderSummary.orderId
            ? { ...item, ...nextOrderSummary }
            : item
        ));
      }
      return current.map((item) => (
        item.id === cost.orderId || item.orderId === cost.orderId
          ? recalculateOrderSummary(item, item.costs?.filter((row) => row.id !== cost.id) || [])
          : item
      ));
    });
    setDetailOrderSummary((current) => {
      if (!current) return current;
      if (nextOrderSummary && (current.id === nextOrderSummary.id || current.orderId === nextOrderSummary.orderId)) {
        return { ...current, ...nextOrderSummary };
      }
      if (current.id === cost.orderId || current.orderId === cost.orderId) {
        return recalculateOrderSummary(current, current.costs?.filter((row) => row.id !== cost.id) || []);
      }
      return current;
    });
    setDetailCost((current) => current?.id === cost.id ? null : current);
    setDocumentCost((current) => current?.id === cost.id ? null : current);
    setVoucherPreviewCost((current) => current?.id === cost.id ? null : current);
    setCostFormDrawer((current) => current?.cost?.id === cost.id ? null : current);
  }

  async function deleteCost(cost: CostRow) {
    const confirmationResult = await requestConfirmation({
      title: "删除成本明细",
      message: "确认删除这条成本明细吗？删除后将影响该订单成本合计和利润分析。",
      details: [
        `订单：${cost.orderNo || "-"}`,
        `成本：${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} ${moneyText(cost.currency, cost.amount, cost.amountCny)}`,
      ],
      confirmLabel: "删除成本",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostDeleteResponse>(`/api/costs/${encodeURIComponent(cost.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "删除成本失败");
      applyDeletedCost(cost, result.orderSummary);
      setNotice(result.message || (result.action === "voided" ? "成本明细已作废" : "成本明细已删除"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除成本失败");
    } finally {
      setDeletingId("");
    }
  }
}
