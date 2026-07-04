"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, PaginationBar, UiCheckbox, useConfirmationDialog } from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import styles from "../WorkspaceShell.module.css";
import { CostFilterPanel } from "./costs/cost-filter-panel";
import { CostDocumentsDrawer, PaymentVoucherPreviewModal } from "./costs/documents-drawer";
import { CostDetailDrawer, CostInvoiceGroupDrawer, CostOrderSummaryDrawer } from "./costs/detail-drawers";
import { CostFormDrawer } from "./costs/cost-form-drawer";
import { CostDetailTableHead, CostInvoiceGroupRows, CostInvoiceGroupTableHead, CostOrderSummaryRows, CostOrderTableHead, CostTableRows, costViewColSpan, costViewLabel } from "./costs/cost-table";
import { hasPaymentVoucher } from "./costs/helpers";
import { PAGE_SIZE, emptyCostFilters, type CostFilters, type CostFormDrawerState, type CostInvoiceGroupRow, type CostOrderSummary, type CostRow, type CostsResponse, type CostView } from "./costs/model";
import { useCostDocumentActions } from "./costs/use-cost-document-actions";

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

  const {
    fetchCostDetail,
    openCostDocuments,
    openInvoiceGroupDocuments,
    uploadCostDocument,
    updateProductSupplierCostPayment,
    uploadPaymentVoucher,
    deleteCostDocument,
    deleteCost,
  } = useCostDocumentActions({
    rows,
    setRows,
    setOrderRows,
    setDetailCost,
    setDetailOrderSummary,
    setDetailInvoiceGroup,
    setCostFormDrawer,
    setDocumentCost,
    setDocumentLoading,
    setDocumentError,
    setUploadingKey,
    setPaymentSavingId,
    setVoucherUploadingKey,
    setVoucherPreviewCost,
    setUploadProgressByKey,
    setDeletingDocumentId,
    setDeletingId,
    setError,
    setNotice,
    costView,
    page,
    submittedFilters,
    archiveScope,
    canManageFactoryPayments,
    loadCosts,
    requestConfirmation,
  });

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

      <CostFilterPanel
        costView={costView}
        filters={filters}
        archiveScope={archiveScope}
        loading={loading}
        onChangeView={changeCostView}
        onChangeArchiveScope={changeArchiveScope}
        onSetFilter={setFilter}
        onSubmit={submitSearch}
        onReset={resetSearch}
      />

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


}
