"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, DismissibleLayer, MoneyAmount, PaginationBar, SideDetailDrawer, UiTabs, useConfirmationDialog } from "../components";
import { formatCny, formatDate, moneyText } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission, customerDisplayName, customerLegalName, isPdfFile } from "../utils";
import styles from "../WorkspaceShell.module.css";

const QUICK_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款", "银行手续费", "样品费", "国外佣金", "国外代理费", "佣金", "其他费用"];
const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
const COST_INVOICE_STATUSES = ["未收到", "已收到"];
const COST_CONFIRMATION_OPTIONS = [
  { label: "未确认", value: "false" },
  { label: "已确认", value: "true" },
];
const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
const FOREIGN_CURRENCY_COST_TYPES = ["国外佣金", "国外代理费", "佣金"];
const FACTORY_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款"];
const LOGISTICS_INVOICE_COST_TYPES = ["拖车费", "国内物流费", "国内拖车费", "报关费", "港杂费", "海运费"];
const FACTORY_DOCUMENT_TYPES = [
  { value: "SUPPLIER_PURCHASE_CONTRACT", label: "工厂采购合同", required: true },
  { value: "SUPPLIER_INVOICE", label: "工厂增值税发票", required: true },
];

type UserLite = {
  name?: string;
};

type CostRow = {
  id: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  supplierName?: string;
  supplierNameSnapshot?: string;
  vendorName?: string;
  costType?: string;
  currency?: string;
  exchangeRate?: number;
  amount?: number;
  amountCny?: number;
  paymentStatus?: string;
  paymentDate?: string;
  invoiceStatus?: string;
  costConfirmed?: boolean;
  sourceLabel?: string;
  sourceType?: string;
  supplierId?: string;
  remark?: string;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
  supplierType?: string;
  documents?: CostDocument[];
};

type CostDocument = {
  id: string;
  documentType?: string;
  fileName?: string;
  fileSize?: number;
  uploadStatus?: string;
  uploadedByName?: string;
  uploadedAt?: string;
  costId?: string;
  supplierId?: string;
};

type CostsPage = {
  rows: CostRow[] | CostOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
};

type CostsResponse = {
  success: boolean;
  data: CostsPage;
  costs?: CostRow[];
};

type CostDetailResponse = {
  success?: boolean;
  cost?: CostRow;
  data?: {
    cost?: CostRow;
  };
  message?: string;
};

type CostOrderOption = {
  id: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
};

type OrdersResponse = {
  orders: CostOrderOption[];
};

type SupplierOption = {
  id: string;
  supplierName?: string;
  name?: string;
  supplierType?: string;
  invoiceTitle?: string;
};

type SuppliersResponse = {
  suppliers: SupplierOption[];
};

type ExchangeRateResponse = {
  rate?: {
    rateToCny?: number;
    exchangeRate?: number;
    rate?: number;
    source?: string;
    rateType?: string;
    rateDate?: string;
  };
};

type CostOrderSummary = {
  id: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  receivableAmountCny?: number;
  totalCostCny?: number;
  factoryCostCny?: number;
  logisticsCostCny?: number;
  portCostCny?: number;
  otherCostCny?: number;
  costCount?: number;
  costConfirmProgress?: {
    completed?: number;
    total?: number;
    text?: string;
  };
  documentProgress?: {
    completed?: number;
    total?: number;
    text?: string;
  };
};

type CostFilters = {
  keyword: string;
  costType: string;
  paymentStatus: string;
  costConfirmed: string;
  invoiceStatus: string;
  dateFrom: string;
  dateTo: string;
};

type QuickCostForm = {
  orderId: string;
};

type CostItemForm = {
  localId: string;
  supplierId: string;
  costType: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  paymentStatus: string;
  paymentDate: string;
  costConfirmed: string;
  remark: string;
};

type CostFormDrawerState = {
  mode: "create" | "edit";
  cost: CostRow | null;
};

const PAGE_SIZE = 20;

const emptyQuickCostForm: QuickCostForm = {
  orderId: "",
};

function emptyCostItemForm(): CostItemForm {
  return {
    localId: `cost-item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    supplierId: "",
    costType: "工厂货款",
    amount: "",
    currency: "CNY",
    exchangeRate: "1",
    paymentStatus: "待支付",
    paymentDate: "",
    costConfirmed: "false",
    remark: "",
  };
}

const emptyCostFilters: CostFilters = {
  keyword: "",
  costType: "",
  paymentStatus: "",
  costConfirmed: "",
  invoiceStatus: "",
  dateFrom: "",
  dateTo: "",
};

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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<CostFilters>({ ...emptyCostFilters });
  const [submittedFilters, setSubmittedFilters] = useState<CostFilters>({ ...emptyCostFilters });
  const [costView, setCostView] = useState<"details" | "orders">("details");
  const [archiveScope, setArchiveScope] = useState("current");
  const [detailCost, setDetailCost] = useState<CostRow | null>(null);
  const [detailOrderSummary, setDetailOrderSummary] = useState<CostOrderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [costFormDrawer, setCostFormDrawer] = useState<CostFormDrawerState | null>(null);
  const [documentCost, setDocumentCost] = useState<CostRow | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
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

  function openCreateCostDrawer() {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDocumentCost(null);
    setCostFormDrawer({ mode: "create", cost: null });
  }

  function openEditCostDrawer(cost: CostRow) {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setDocumentCost(null);
    setCostFormDrawer({ mode: "edit", cost });
  }

  function closeCostFormDrawer() {
    setCostFormDrawer(null);
  }

  async function loadCosts(
    nextPage = page,
    nextFilters = submittedFilters,
    nextArchiveScope = archiveScope,
    nextView = costView,
  ) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        archiveScope: nextArchiveScope,
        view: nextView,
      });
      if (nextFilters.keyword.trim()) params.set("keyword", nextFilters.keyword.trim());
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (key === "keyword") return;
        const text = String(value || "").trim();
        if (text) params.set(key, text);
      });
      const result = await apiJson<CostsResponse>(`/api/costs?${params}`);
      const data = result.data || { rows: result.costs || [], total: result.costs?.length || 0, page: nextPage, pageSize: PAGE_SIZE };
      if (nextView === "orders") {
        setOrderRows(Array.isArray(data.rows) ? (data.rows as CostOrderSummary[]) : []);
        setRows([]);
      } else {
        setRows(Array.isArray(data.rows) ? (data.rows as CostRow[]) : []);
        setOrderRows([]);
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
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, nextFilters, archiveScope, "details");
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
  const activeRows = costView === "orders" ? orderRows : rows;

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
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, { ...emptyCostFilters }, "current", costView);
  }

  function gotoPage(nextPage: number) {
    setDetailCost(null);
    setDetailOrderSummary(null);
    setCostFormDrawer(null);
    void loadCosts(nextPage, submittedFilters, archiveScope, costView);
  }

  function changeArchiveScope(nextArchiveScope: string) {
    setArchiveScope(nextArchiveScope);
    setDetailCost(null);
    setDetailOrderSummary(null);
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, submittedFilters, nextArchiveScope, costView);
  }

  function changeCostView(nextView: "details" | "orders") {
    setCostView(nextView);
    setDetailCost(null);
    setDetailOrderSummary(null);
    setCostFormDrawer(null);
    setNotice("");
    void loadCosts(1, submittedFilters, archiveScope, nextView);
  }

  return (
    <section className={styles.moduleCard}>
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
          className={costView === "details" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => changeCostView("details")}
        >
          成本明细
        </button>
        <button
          className={costView === "orders" ? styles.primaryButtonCompact : styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={() => changeCostView("orders")}
        >
          按订单汇总
        </button>
      </div>

      <div className={styles.listToolbar}>
        <input
          value={filters.keyword}
          onChange={(event) => setFilter("keyword", event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 成本类型 / 供应商 / 备注"
        />
        <select value={archiveScope} onChange={(event) => changeArchiveScope(event.target.value)} disabled={loading}>
          <option value="current">当前业务</option>
          <option value="archive">已归档业务</option>
          <option value="all">全部业务</option>
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      <div className={styles.reportFilterGrid}>
        <label>
          成本类型
          <select value={filters.costType} onChange={(event) => setFilter("costType", event.target.value)}>
            <option value="">全部成本类型</option>
            {[...QUICK_COST_TYPES, "拖车费", "报关费", "港杂费", "海运费", "保险费", "其他物流费用"].map((type) => (
              <option key={type} value={type}>{type}</option>
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
        <label>
          成本确认
          <select value={filters.costConfirmed} onChange={(event) => setFilter("costConfirmed", event.target.value)}>
            <option value="">全部确认状态</option>
            {COST_CONFIRMATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          发票状态
          <select value={filters.invoiceStatus} onChange={(event) => setFilter("invoiceStatus", event.target.value)}>
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

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
        <table className={styles.dataTable}>
          {costView === "orders" ? <CostOrderTableHead /> : <CostDetailTableHead />}
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : activeRows.length ? (costView === "orders"
              ? orderRows.map((order) => (
                <CostOrderSummaryRows
                  key={order.id}
                  order={order}
                  onViewDetail={() => setDetailOrderSummary(order)}
                  onViewDetails={() => {
                    const nextFilters = { ...emptyCostFilters, keyword: order.orderNo || "" };
                    setCostView("details");
                    setFilters(nextFilters);
                    setSubmittedFilters(nextFilters);
                    setDetailOrderSummary(null);
                    void loadCosts(1, nextFilters, archiveScope, "details");
                  }}
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
                />
              ))
            ) : (
              <tr>
                <td colSpan={8}><div className={styles.emptyState}>未找到匹配的{costView === "orders" ? "订单成本汇总" : "成本明细"}</div></td>
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
          onEdit={() => openEditCostDrawer(detailCost)}
          onDelete={() => void deleteCost(detailCost)}
          onClose={() => setDetailCost(null)}
        />
      ) : null}
      {costFormDrawer ? (
        <CostFormDrawer
          drawer={costFormDrawer}
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
          onViewDetails={() => {
            const nextFilters = { ...emptyCostFilters, keyword: detailOrderSummary.orderNo || "" };
            setCostView("details");
            setFilters(nextFilters);
            setSubmittedFilters(nextFilters);
            setDetailOrderSummary(null);
            void loadCosts(1, nextFilters, archiveScope, "details");
          }}
          onClose={() => setDetailOrderSummary(null)}
        />
      ) : null}

      {documentCost ? (
        <CostDocumentsDrawer
          cost={documentCost}
          loading={documentLoading}
          error={documentError}
          uploadingKey={uploadingKey}
          deletingDocumentId={deletingDocumentId}
          canWriteDocuments={canWriteDocuments}
          onClose={() => {
            setDocumentCost(null);
            setDocumentError("");
            setUploadingKey("");
            setDeletingDocumentId("");
          }}
          onUpload={(cost, documentType, file) => void uploadCostDocument(cost, documentType, file)}
          onDelete={(cost, document) => void deleteCostDocument(cost, document)}
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
  );

  async function fetchCostDetail(id: string) {
    const result = await apiJson<CostDetailResponse>(`/api/costs/${encodeURIComponent(id)}`);
    const cost = result.cost || result.data?.cost;
    if (!cost) throw new Error(result.message || "未找到成本详情");
    setRows((current) => current.map((item) => item.id === cost.id ? { ...item, ...cost } : item));
    setDetailCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setDocumentCost((current) => current?.id === cost.id ? { ...current, ...cost } : current);
    setCostFormDrawer((current) => current?.cost?.id === cost.id ? { ...current, cost: { ...current.cost, ...cost } } : current);
    return cost;
  }

  async function openCostDocuments(id: string) {
    const cached = rows.find((cost) => cost.id === id) || null;
    setDetailCost(null);
    setDetailOrderSummary(null);
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
    if (!isPdfFile(file)) {
      setDocumentError("只能上传 PDF 文件");
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
      const response = await fetch("/api/order-documents", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "资料上传失败");
      }
      await refreshDocumentCost(cost.id);
      setNotice("资料已上传");
    } catch (uploadError) {
      setDocumentError(uploadError instanceof Error ? uploadError.message : "资料上传失败");
    } finally {
      setUploadingKey("");
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
      setNotice("资料已删除");
    } catch (deleteError) {
      setDocumentError(deleteError instanceof Error ? deleteError.message : "删除资料失败");
    } finally {
      setDeletingDocumentId("");
    }
  }

  async function deleteCost(cost: CostRow) {
    const confirmationResult = await requestConfirmation({
      title: "确认删除这条成本？",
      message: "删除后将重新计算利润和退税资料完整度。",
      details: [
        `订单：${cost.orderNo || "-"}`,
        `成本：${cost.costType || "-"} ${moneyText(cost.currency, cost.amount, cost.amountCny)}`,
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
      const result = await apiJson<{ success?: boolean; ok?: boolean; message?: string }>(`/api/costs/${encodeURIComponent(cost.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "删除成本失败");
      setDetailCost(null);
      setDetailOrderSummary(null);
      setCostFormDrawer((current) => current?.cost?.id === cost.id ? null : current);
      await loadCosts(page, submittedFilters, archiveScope, costView);
      setNotice(result.message || "成本已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除成本失败");
    } finally {
      setDeletingId("");
    }
  }
}

function CostFormDrawer({
  drawer,
  onCancel,
  onSaved,
}: {
  drawer: CostFormDrawerState;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const cost = drawer.cost;
  const editMode = drawer.mode === "edit";
  const supplierName = cost ? (cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-") : "-";
  const title = editMode
    ? `${cost?.orderNo || "-"} · ${customerDisplayName(cost || {})}`
    : "登记成本";
  const subtitle = editMode
    ? `成本类型：${cost?.costType || "-"} · 付款状态：${cost?.paymentStatus || "-"} · 供应商：${supplierName}`
    : "选择订单后登记供应商成本，保存后当前筛选和页码保持不变。";

  return (
    <SideDetailDrawer
      ariaLabel={editMode ? "编辑成本" : "登记成本"}
      kicker="成本管理"
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
    >
      <QuickCreateCostPanel
        drawerMode
        initialCost={cost}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    </SideDetailDrawer>
  );
}

function QuickCreateCostPanel({
  initialCost,
  drawerMode = false,
  onCancel,
  onSaved,
}: {
  initialCost?: CostRow | null;
  drawerMode?: boolean;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [form, setForm] = useState<QuickCostForm>(() => costFormFromRow(initialCost));
  const [items, setItems] = useState<CostItemForm[]>(() => [costItemFromRow(initialCost)]);
  const [orders, setOrders] = useState<CostOrderOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [exchangeMetaByItem, setExchangeMetaByItem] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const editMode = Boolean(initialCost?.id);

  useEffect(() => {
    const nextItem = costItemFromRow(initialCost);
    setForm(costFormFromRow(initialCost));
    setItems([nextItem]);
    setExchangeMetaByItem({ [nextItem.localId]: exchangeRateMeta(nextItem.currency) });
    setMessage("");
  }, [initialCost?.id]);

  useEffect(() => {
    setExchangeMetaByItem((current) => {
      let changed = false;
      const next = { ...current };
      items.forEach((item) => {
        if (!next[item.localId]) {
          next[item.localId] = exchangeRateMeta(item.currency);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [items]);

  async function searchOrders(keyword: string) {
    try {
      const params = new URLSearchParams({ q: keyword.trim() });
      const result = await apiJson<OrdersResponse>(`/api/receivables/search?${params}`);
      return Array.isArray(result.orders) ? result.orders : [];
    } catch (orderError) {
      setMessage(orderError instanceof Error ? orderError.message : "读取订单列表失败");
      return [];
    }
  }

  async function searchSuppliers(keyword: string, costType: string) {
    try {
      const params = new URLSearchParams({ status: "active" });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (FACTORY_COST_TYPES.includes(costType)) params.set("type", "factory");
      const result = await apiJson<SuppliersResponse>(`/api/suppliers/search?${params}`);
      return Array.isArray(result.suppliers) ? result.suppliers : [];
    } catch (supplierError) {
      setMessage(supplierError instanceof Error ? supplierError.message : "读取供应商列表失败");
      return [];
    }
  }

  function setFormValue<K extends keyof QuickCostForm>(key: K, value: QuickCostForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setItemValue<K extends keyof CostItemForm>(localId: string, key: K, value: CostItemForm[K]) {
    setItems((current) => current.map((item) => item.localId === localId ? { ...item, [key]: value } : item));
  }

  function mergeSupplier(supplier: SupplierOption) {
    setSuppliers((current) => current.some((item) => item.id === supplier.id) ? current : [supplier, ...current]);
  }

  function handleOrderSelect(order: CostOrderOption) {
    setOrders((current) => current.some((item) => item.id === order.id) ? current : [order, ...current]);
    setFormValue("orderId", order.id);
  }

  function handleSupplierSelect(localId: string, supplier: SupplierOption) {
    mergeSupplier(supplier);
    setItemValue(localId, "supplierId", supplier.id);
  }

  async function resolveExchangeRate(localId: string, currency: string, paymentDate = items.find((item) => item.localId === localId)?.paymentDate || "") {
    const normalized = currency.trim().toUpperCase();
    if (normalized === "CNY") {
      setExchangeMetaByItem((current) => ({ ...current, [localId]: "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" }));
      setItemValue(localId, "exchangeRate", "1");
      return;
    }
    setExchangeMetaByItem((current) => ({ ...current, [localId]: "正在获取汇率..." }));
    try {
      const params = new URLSearchParams({ currency: normalized });
      if (paymentDate) params.set("date", paymentDate);
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${params}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setItemValue(localId, "exchangeRate", String(rate));
        setExchangeMetaByItem((current) => ({
          ...current,
          [localId]: `来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`,
        }));
      } else {
        setExchangeMetaByItem((current) => ({ ...current, [localId]: "汇率来源：待获取，请手工填写" }));
      }
    } catch (rateError) {
      setExchangeMetaByItem((current) => ({ ...current, [localId]: rateError instanceof Error ? rateError.message : "汇率获取失败，请手工填写" }));
    }
  }

  async function handleCostTypeChange(localId: string, costType: string) {
    const item = items.find((row) => row.localId === localId);
    const selectedSupplier = suppliers.find((supplier) => supplier.id === item?.supplierId);
    const currency = FOREIGN_CURRENCY_COST_TYPES.includes(costType) ? (item?.currency || "CNY") : "CNY";
    setItems((current) => current.map((row) => row.localId === localId ? {
      ...row,
      costType,
      currency,
      exchangeRate: currency === "CNY" ? "1" : "",
      supplierId: FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && selectedSupplier.supplierType !== "工厂供应商" ? "" : row.supplierId,
    } : row));
    if (FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && selectedSupplier.supplierType !== "工厂供应商") {
      setMessage("当前成本类型需要选择工厂供应商，请重新选择供应商。");
    }
    await resolveExchangeRate(localId, currency);
  }

  async function handleCurrencyChange(localId: string, currency: string) {
    const normalized = currency.toUpperCase();
    setItems((current) => current.map((item) => item.localId === localId ? { ...item, currency: normalized, exchangeRate: normalized === "CNY" ? "1" : "" } : item));
    await resolveExchangeRate(localId, normalized);
  }

  function addCostItem(copyPrevious = false) {
    setItems((current) => {
      const previous = current[current.length - 1] || emptyCostItemForm();
      const next = copyPrevious
        ? { ...previous, localId: emptyCostItemForm().localId, supplierId: previous.supplierId, amount: "", remark: "" }
        : emptyCostItemForm();
      setExchangeMetaByItem((meta) => ({ ...meta, [next.localId]: next.currency === "CNY" ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" : "汇率来源：待获取" }));
      return [...current, next];
    });
  }

  function removeCostItem(localId: string) {
    setItems((current) => current.length <= 1 ? current : current.filter((item) => item.localId !== localId));
    setExchangeMetaByItem((current) => {
      const next = { ...current };
      delete next[localId];
      return next;
    });
  }

  async function submitQuickCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
    for (const [index, item] of items.entries()) {
      if (!item.supplierId) {
        setMessage(`第 ${index + 1} 条成本请选择供应商`);
        return;
      }
      if (!item.amount || Number(item.amount) <= 0) {
        setMessage(`第 ${index + 1} 条成本请填写供应商成本金额`);
        return;
      }
      if (!item.currency) {
        setMessage(`第 ${index + 1} 条成本请选择币种`);
        return;
      }
      if (!Number(item.exchangeRate)) {
        setMessage(`第 ${index + 1} 条成本请填写汇率；CNY 成本汇率应自动为 1`);
        return;
      }
      if (item.paymentStatus === "已支付" && !item.paymentDate) {
        setMessage(`第 ${index + 1} 条成本已支付时必须填写付款日期`);
        return;
      }
    }

    setSaving(true);
    setMessage("");
    try {
      const isEdit = editMode;
      const payloadItems = items.map((item) => ({
        supplierId: item.supplierId,
        costType: item.costType,
        amount: Number(item.amount),
        currency: item.currency,
        exchangeRate: Number(item.exchangeRate),
        paymentStatus: item.paymentStatus,
        paymentDate: item.paymentDate || undefined,
        costConfirmed: item.costConfirmed === "true",
        remark: item.remark.trim(),
      }));
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/costs/${encodeURIComponent(initialCost?.id || "")}` : "/api/costs",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(isEdit
            ? { orderId: form.orderId, ...payloadItems[0] }
            : { orderId: form.orderId, items: payloadItems }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "成本保存失败");
      setForm(costFormFromRow(null));
      const freshItem = emptyCostItemForm();
      setItems([freshItem]);
      setExchangeMetaByItem({ [freshItem.localId]: "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" });
      await onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "成本保存失败");
    } finally {
      setSaving(false);
    }
  }

  const initialOrder = initialCost?.orderId ? {
    id: initialCost.orderId,
    orderNo: initialCost.orderNo,
    blNo: initialCost.blNo,
    billOfLadingNo: initialCost.billOfLadingNo,
    customerName: initialCost.customerName,
    customerFullName: initialCost.customerFullName,
    customerShortName: initialCost.customerShortName,
  } : null;
  const initialSupplier = initialSupplierFromCost(initialCost);
  const orderOptions = initialOrder && !orders.some((order) => order.id === initialOrder.id) ? [initialOrder, ...orders] : orders;
  const supplierOptions = initialSupplier && !suppliers.some((supplier) => supplier.id === initialSupplier.id) ? [initialSupplier, ...suppliers] : suppliers;
  const selectedOrder = orderOptions.find((order) => order.id === form.orderId);

  return (
    <form className={`${styles.quickCreatePanel} ${drawerMode ? styles.quickCreatePanelInDrawer : ""}`} onSubmit={submitQuickCost}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{editMode ? "编辑成本" : "批量登记成本"}</strong>
          <span>{editMode ? "编辑单条人工成本记录。" : "可在同一订单下一次录入多条供应商成本。"}</span>
        </div>
        {!editMode ? (
          <div className={styles.detailActions}>
            <button className={styles.secondaryButton} type="button" onClick={() => addCostItem(false)}>添加一条</button>
            <button className={styles.secondaryButton} type="button" onClick={() => addCostItem(true)}>复制上一条</button>
          </div>
        ) : null}
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            disabled={editMode}
            cacheKey="cost-orders"
            emptyLabel="未找到订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={customerLegalName}
            search={searchOrders}
            onSelect={handleOrderSelect}
          />
        </label>
      </div>

      <div className={styles.documentGroupCard}>
        <strong>成本明细</strong>
        {items.map((item, index) => {
          const selectedSupplier = supplierOptions.find((supplier) => supplier.id === item.supplierId) || null;
          const forceCny = !FOREIGN_CURRENCY_COST_TYPES.includes(item.costType);
          return (
            <div className={styles.documentGroupCard} key={item.localId}>
              <div className={styles.quickCreateHeader}>
                <div>
                  <strong>第 {index + 1} 条成本</strong>
                  <span>{selectedSupplier ? supplierLabel(selectedSupplier) : "请选择供应商"}</span>
                </div>
                {!editMode && items.length > 1 ? (
                  <button className={styles.secondaryButton} type="button" onClick={() => removeCostItem(item.localId)}>删除此条</button>
                ) : null}
              </div>
              <div className={styles.reportFilterGrid}>
                <label>
                  供应商
                  <SearchAutocomplete
                    value={selectedSupplier}
                    cacheKey={`cost-suppliers:${FACTORY_COST_TYPES.includes(item.costType) ? "factory" : "all"}:${item.localId}`}
                    emptyLabel="未找到匹配供应商，可先到系统设置新增供应商"
                    placeholder={FACTORY_COST_TYPES.includes(item.costType) ? "输入工厂供应商 / 开票名称 / 税号" : "输入供应商 / 类型 / 开票名称 / 税号"}
                    getLabel={supplierLabel}
                    getDescription={(supplier) => supplier.invoiceTitle || supplier.supplierType || ""}
                    search={(keyword) => searchSuppliers(keyword, item.costType)}
                    onSelect={(supplier) => handleSupplierSelect(item.localId, supplier)}
                  />
                </label>
                <label>
                  成本类型
                  <select value={item.costType} onChange={(event) => void handleCostTypeChange(item.localId, event.target.value)}>
                    {QUICK_COST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label>
                  成本金额
                  <input value={item.amount} onChange={(event) => setItemValue(item.localId, "amount", event.target.value)} inputMode="decimal" required />
                </label>
                <label>
                  币种
                  <select value={item.currency} onChange={(event) => void handleCurrencyChange(item.localId, event.target.value)} disabled={forceCny}>
                    {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </select>
                </label>
                <label>
                  汇率
                  <input
                    value={item.exchangeRate}
                    onChange={(event) => setItemValue(item.localId, "exchangeRate", event.target.value)}
                    readOnly={item.currency === "CNY"}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label>
                  付款状态
                  <select value={item.paymentStatus} onChange={(event) => setItemValue(item.localId, "paymentStatus", event.target.value)}>
                    {COST_PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                {item.paymentStatus === "已支付" ? (
                  <label>
                    付款日期
                    <input
                      value={item.paymentDate}
                      onChange={(event) => setItemValue(item.localId, "paymentDate", event.target.value)}
                      type="date"
                      required
                    />
                  </label>
                ) : null}
                <label>
                  成本确认
                  <select value={item.costConfirmed} onChange={(event) => setItemValue(item.localId, "costConfirmed", event.target.value)}>
                    {COST_CONFIRMATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  备注
                  <input value={item.remark} onChange={(event) => setItemValue(item.localId, "remark", event.target.value)} placeholder="可选" />
                </label>
              </div>
              <div className={styles.quickCreateMeta}>
                <span>供应商：{selectedSupplier ? supplierLabel(selectedSupplier) : "-"}</span>
                <span>{exchangeMetaByItem[item.localId] || "汇率来源：待获取"}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.quickCreateMeta}>
        <span>订单：{selectedOrder ? orderLabel(selectedOrder) : "-"}</span>
        <span>成本条数：{items.length}</span>
      </div>

      <div className={`${styles.detailActions} ${drawerMode ? styles.drawerFormActions : ""}`}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : editMode ? "更新成本" : `保存 ${items.length} 条成本`}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function CostTableRows({
  cost,
  onViewDetail,
  deleting,
  onEdit,
  onDelete,
  onOpenDocuments,
}: {
  cost: CostRow;
  onViewDetail: () => void;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenDocuments: () => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const manualCost = cost.sourceType !== "LOGISTICS_EXPENSE";
  return (
    <>
      <tr className={styles.clickableRow} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{cost.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(cost)}>{customerDisplayName(cost)}</td>
        <td>{cost.costType || "-"}</td>
        <td>{supplierName}</td>
        <td className={styles.amountColumn}><MoneyAmount currency={cost.currency} amount={cost.amount} amountCny={cost.amountCny} /></td>
        <td><span className={`${styles.statusPill} ${cost.paymentStatus === "已支付" ? styles.statusSuccess : styles.statusWarning}`}>{cost.paymentStatus || "-"}</span></td>
        <td><span className={`${styles.statusPill} ${cost.invoiceStatus === "已收到" ? styles.statusSuccess : styles.statusMuted}`}>{cost.invoiceStatus || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}

function CostDetailTableHead() {
  return (
    <thead>
      <tr>
        <th className={styles.orderNoColumn}>订单号</th>
        <th className={styles.customerColumn}>客户简称</th>
        <th>成本类型</th>
        <th>供应商</th>
        <th className={styles.amountColumn}>成本金额</th>
        <th>付款状态</th>
        <th>发票状态</th>
        <th>详情</th>
      </tr>
    </thead>
  );
}

function CostOrderTableHead() {
  return (
    <thead>
      <tr>
        <th className={styles.orderNoColumn}>订单号</th>
        <th className={styles.customerColumn}>客户简称</th>
        <th className={styles.blNoColumn}>提单号</th>
        <th className={styles.amountColumn}>总成本</th>
        <th>成本确认</th>
        <th>资料状态</th>
        <th>成本条数</th>
        <th>详情</th>
      </tr>
    </thead>
  );
}

function CostOrderSummaryRows({
  order,
  onViewDetail,
  onViewDetails,
}: {
  order: CostOrderSummary;
  onViewDetail: () => void;
  onViewDetails: () => void;
}) {
  const confirmProgress = order.costConfirmProgress?.text || "无成本";
  const documentProgress = order.documentProgress?.text || "无需资料";
  return (
    <>
      <tr className={styles.clickableRow} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{order.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(order)}>{customerDisplayName(order)}</td>
        <td className={styles.blNoColumn}>{order.blNo || order.billOfLadingNo || "-"}</td>
        <td className={styles.amountColumn}><MoneyAmount amountCny={order.totalCostCny || 0} /></td>
        <td><span className={styles.statusPill}>{confirmProgress}</span></td>
        <td><span className={styles.statusPill}>{documentProgress}</span></td>
        <td>{Number(order.costCount || 0)}</td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}

function CostDetailDrawer({
  cost,
  deleting,
  onOpenDocuments,
  onEdit,
  onDelete,
  onClose,
}: {
  cost: CostRow;
  deleting: boolean;
  onOpenDocuments: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState("basic");
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const manualCost = cost.sourceType !== "LOGISTICS_EXPENSE";

  useEffect(() => {
    setActiveTab("basic");
  }, [cost.id]);

  return (
    <SideDetailDrawer
      ariaLabel="成本详情"
      kicker="成本管理"
      title={`${cost.orderNo || "-"} · ${customerLegalName(cost)}`}
      subtitle={`成本类型：${cost.costType || "-"} · 付款状态：${cost.paymentStatus || "-"} · 供应商：${supplierName}`}
      onClose={onClose}
      actions={
        <>
          <button className={styles.primaryButtonCompact} type="button" onClick={onOpenDocuments}>资料维护</button>
          {manualCost ? (
            <>
              <button className={styles.secondaryButton} type="button" onClick={onEdit}>编辑成本</button>
              <button className={styles.secondaryButton} type="button" disabled={deleting} onClick={onDelete}>
                {deleting ? "删除中..." : "删除成本"}
              </button>
            </>
          ) : null}
        </>
      }
    >
      {!manualCost ? <div className={styles.infoStrip}>系统生成的成本记录不可在此直接编辑。</div> : null}
      <UiTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: "basic", label: "基本信息" },
          { key: "payment", label: "付款信息" },
          { key: "invoice", label: "发票信息" },
          { key: "audit", label: "操作记录" },
        ]}
      />
      {activeTab === "basic" ? (
        <div className={styles.detailGrid}>
          <DetailField label="客户全称" value={customerLegalName(cost)} wide />
          <DetailField label="订单号" value={cost.orderNo || "-"} />
          <DetailField label="提单号" value={cost.blNo || cost.billOfLadingNo || "-"} />
          <DetailField label="成本类型" value={cost.costType || "-"} />
          <DetailField label="供应商" value={supplierName} />
          <DetailMoneyField label="成本金额" cost={cost} />
          <DetailField label="币种 / 汇率" value={`${cost.currency || "-"} / ${Number(cost.exchangeRate || 0).toFixed(4)}`} />
          <DetailField label="来源" value={cost.sourceLabel || "人工录入"} />
          <DetailField label="备注" value={cost.remark || "-"} wide hidden={!cost.remark} />
        </div>
      ) : null}
      {activeTab === "payment" ? (
        <div className={styles.detailGrid}>
          <DetailField label="付款状态" value={cost.paymentStatus || "-"} />
          <DetailField label="付款日期" value={formatDate(cost.paymentDate)} />
          <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
          <DetailMoneyField label="付款金额" cost={cost} />
        </div>
      ) : null}
      {activeTab === "invoice" ? (
        <div className={styles.detailGrid}>
          <DetailField label="发票状态" value={cost.invoiceStatus || "-"} />
          <DetailField label="供应商" value={supplierName} />
          <DetailField label="成本类型" value={cost.costType || "-"} />
          <DetailField label="资料维护" value="点击上方“资料维护”查看或上传发票资料。" wide />
        </div>
      ) : null}
      {activeTab === "audit" ? (
        <div className={styles.detailGrid}>
          <DetailField label="创建人" value={cost.createdBy?.name || "-"} />
          <DetailField label="创建时间" value={formatDate(cost.createdAt)} />
          <DetailField label="修改人" value={cost.updatedBy?.name || "-"} />
          <DetailField label="更新时间" value={formatDate(cost.updatedAt)} />
          <DetailField label="记录来源" value={cost.sourceLabel || "人工录入"} />
        </div>
      ) : null}
    </SideDetailDrawer>
  );
}

function DetailMoneyField({ label, cost }: { label: string; cost: CostRow }) {
  return (
    <div className={styles.detailField}>
      <span>{label}</span>
      <MoneyAmount
        className={styles.detailAmountCell}
        currency={cost.currency}
        amount={cost.amount}
        amountCny={cost.amountCny}
      />
    </div>
  );
}

function CostOrderSummaryDrawer({
  order,
  onViewDetails,
  onClose,
}: {
  order: CostOrderSummary;
  onViewDetails: () => void;
  onClose: () => void;
}) {
  const confirmProgress = order.costConfirmProgress?.text || "无成本";
  const documentProgress = order.documentProgress?.text || "无需资料";
  return (
    <SideDetailDrawer
      ariaLabel="订单成本汇总详情"
      kicker="成本汇总"
      title={`${order.orderNo || "-"} · ${customerLegalName(order)}`}
      subtitle={`提单号：${order.blNo || order.billOfLadingNo || "-"}`}
      onClose={onClose}
      actions={<button className={styles.primaryButtonCompact} type="button" onClick={onViewDetails}>查看成本明细</button>}
    >
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(order)} wide />
        <DetailField label="订单号" value={order.orderNo || "-"} />
        <DetailField label="提单号" value={order.blNo || order.billOfLadingNo || "-"} />
        <DetailField label="最终应收" value={formatCny(Number(order.receivableAmountCny || 0))} />
        <DetailField label="总成本" value={formatCny(Number(order.totalCostCny || 0))} />
        <DetailField label="工厂成本" value={formatCny(Number(order.factoryCostCny || 0))} />
        <DetailField label="物流成本" value={formatCny(Number(order.logisticsCostCny || 0))} />
        <DetailField label="港杂成本" value={formatCny(Number(order.portCostCny || 0))} />
        <DetailField label="其他成本" value={formatCny(Number(order.otherCostCny || 0))} />
        <DetailField label="成本确认" value={confirmProgress} />
        <DetailField label="资料状态" value={documentProgress} />
        <DetailField label="成本条数" value={String(Number(order.costCount || 0))} />
      </div>
    </SideDetailDrawer>
  );
}

function CostDocumentsDrawer({
  cost,
  loading,
  error,
  uploadingKey,
  deletingDocumentId,
  canWriteDocuments,
  onClose,
  onUpload,
  onDelete,
}: {
  cost: CostRow;
  loading: boolean;
  error: string;
  uploadingKey: string;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  onClose: () => void;
  onUpload: (cost: CostRow, documentType: string, file: File | null) => void;
  onDelete: (cost: CostRow, document: CostDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const documentTypes = costDocumentTypesForDrawer(cost);
  const dismissConfirmMessage = uploadingKey ? "当前内容尚未保存，确定关闭吗？" : "";

  return (
    <DismissibleLayer
      ariaLabel="成本资料维护"
      overlayClassName={styles.drawerOverlay}
      surfaceClassName={styles.taxRefundDrawer}
      dismissible
      dismissConfirmMessage={dismissConfirmMessage}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
        <header className={styles.taxRefundDrawerHeader}>
          <div className={styles.taxRefundDrawerTitle}>
            <span>供应商资料 / 发票资料</span>
            <strong>{cost.orderNo || "-"} · {supplierName}</strong>
            <small>{cost.costType || "-"} · 提单号：{cost.blNo || cost.billOfLadingNo || "-"}</small>
          </div>
          <div className={styles.taxRefundDrawerActions}>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </div>
        </header>
        <div className={styles.taxRefundDrawerBody}>
          {loading ? <div className={styles.emptyState}>资料加载中...</div> : null}
          {error ? <div className={styles.inlineError}>{error}</div> : null}
          <div className={styles.documentGroupGrid}>
            <div className={styles.documentGroupCard}>
              <strong>成本信息</strong>
              <div className={styles.detailGrid}>
                <DetailField label="订单号" value={cost.orderNo || "-"} />
                <DetailField label="供应商" value={supplierName} />
                <DetailField label="成本类型" value={cost.costType || "-"} />
                <DetailField label="成本金额" value={moneyText(cost.currency, cost.amount, cost.amountCny)} />
                <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
                <DetailField label="发票状态" value={cost.invoiceStatus || "-"} />
              </div>
            </div>
            <div className={styles.documentGroupCard}>
              <strong>资料要求</strong>
              <span className={styles.mutedText}>
                {isFactoryCost(cost) ? "工厂供应商需维护采购合同和增值税发票。" : isLogisticsInvoiceCost(cost) ? "物流类费用需维护对应物流发票。" : "当前成本可维护一份发票资料。"}
              </span>
            </div>
          </div>
          <div className={styles.documentGroupCard}>
            <strong>资料维护</strong>
            {documentTypes.map((documentType) => (
              <CostDocumentUploadItem
                key={`${cost.id}-${documentType.value}`}
                cost={cost}
                documentType={documentType}
                documents={documentsForType(cost, documentType.value)}
                uploading={uploadingKey === costUploadKey(cost, documentType.value)}
                deletingDocumentId={deletingDocumentId}
                canWriteDocuments={canWriteDocuments}
                onUpload={onUpload}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
        </>
      )}
    </DismissibleLayer>
  );
}

function CostDocumentUploadItem({
  cost,
  documentType,
  documents,
  uploading,
  deletingDocumentId,
  canWriteDocuments,
  onUpload,
  onDelete,
}: {
  cost: CostRow;
  documentType: { value: string; label: string; required?: boolean };
  documents: CostDocument[];
  uploading: boolean;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  onUpload: (cost: CostRow, documentType: string, file: File | null) => void;
  onDelete: (cost: CostRow, document: CostDocument) => void;
}) {
  const completed = documents.some((document) => document.uploadStatus === "SUCCESS");
  return (
    <div className={styles.fileListItem}>
      <div>
        <span>{documentType.label}</span>
        <small>{completed ? `已上传 ${documents.length} 个文件` : documentType.required ? "缺失" : "暂未上传"}</small>
        {documents.map((document) => (
          <small key={document.id}>
            {document.fileName || "-"} ｜ {document.uploadedByName || "-"} ｜ {formatDate(document.uploadedAt)}
          </small>
        ))}
      </div>
      <div>
        {canWriteDocuments ? (
          <label className={styles.secondaryButton}>
            {uploading ? "上传中..." : completed ? "替换/上传PDF" : "选择PDF"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={uploading}
              hidden
              onChange={(event) => {
                onUpload(cost, documentType.value, event.target.files?.[0] || null);
                event.currentTarget.value = "";
              }}
            />
          </label>
        ) : (
          <button className={styles.secondaryButton} type="button" disabled title="无权限操作">无权限操作</button>
        )}
        {documents.map((document) => (
          <span key={document.id} className={styles.fileListItemActions}>
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/preview`} target="_blank" rel="noreferrer">预览</a>
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
            {canWriteDocuments ? (
              <button
                className={styles.secondaryButton}
                type="button"
                disabled={deletingDocumentId === document.id}
                onClick={() => onDelete(cost, document)}
              >
                {deletingDocumentId === document.id ? "删除中..." : "删除"}
              </button>
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function costDocumentTypesForDrawer(cost: CostRow) {
  if (isFactoryCost(cost)) return FACTORY_DOCUMENT_TYPES;
  if (isLogisticsInvoiceCost(cost)) {
    return [{ value: "SUPPLIER_INVOICE", label: logisticsInvoiceLabel(cost), required: true }];
  }
  return [{ value: "SUPPLIER_INVOICE", label: "发票资料", required: false }];
}

function documentsForType(cost: CostRow, documentType: string) {
  return (cost.documents || []).filter((document) => (
    document.documentType === documentType
    && document.uploadStatus === "SUCCESS"
    && (!document.costId || document.costId === cost.id)
  ));
}

function isFactoryCost(cost: CostRow) {
  return cost.supplierType === "工厂供应商" || FACTORY_COST_TYPES.includes(cost.costType || "");
}

function isLogisticsInvoiceCost(cost: CostRow) {
  return LOGISTICS_INVOICE_COST_TYPES.includes(cost.costType || "");
}

function logisticsInvoiceLabel(cost: Pick<CostRow, "costType">) {
  if (["拖车费", "国内物流费", "国内拖车费"].includes(cost.costType || "")) return "拖车费发票";
  if (cost.costType === "报关费") return "报关费发票";
  if (cost.costType === "港杂费") return "港杂费发票";
  if (cost.costType === "海运费") return "海运费发票";
  return "物流发票";
}

function costUploadKey(cost: CostRow, documentType: string) {
  return [cost.orderId || "", cost.id, cost.supplierId || "", documentType].join(":");
}

function costFormFromRow(cost?: CostRow | null): QuickCostForm {
  if (!cost) return { ...emptyQuickCostForm };
  return {
    orderId: cost.orderId || "",
  };
}

function costItemFromRow(cost?: CostRow | null): CostItemForm {
  if (!cost) return emptyCostItemForm();
  return {
    ...emptyCostItemForm(),
    supplierId: cost.supplierId || "",
    costType: cost.costType || "工厂货款",
    amount: cost.amount == null ? "" : String(cost.amount),
    currency: cost.currency || "CNY",
    exchangeRate: cost.exchangeRate == null ? "1" : String(cost.exchangeRate),
    paymentStatus: cost.paymentStatus || "待支付",
    paymentDate: cost.paymentDate || "",
    costConfirmed: cost.costConfirmed ? "true" : "false",
    remark: cost.remark || "",
  };
}

function initialSupplierFromCost(cost?: CostRow | null): SupplierOption | null {
  if (!cost?.supplierId) return null;
  return {
    id: cost.supplierId,
    supplierName: cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商",
    name: cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "未命名供应商",
    supplierType: cost.supplierType || "",
  };
}

function exchangeRateMeta(currency?: string) {
  return (currency || "CNY").toUpperCase() === "CNY" ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" : "汇率来源：待获取";
}

function orderLabel(order: CostOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}

function supplierLabel(supplier: SupplierOption) {
  const name = supplier.supplierName || supplier.name || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}
