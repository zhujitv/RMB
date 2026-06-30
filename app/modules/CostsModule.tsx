"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { ConfirmationDialog, DetailField, DismissibleLayer, MoneyAmount, PaginationBar, PdfPreviewButton, SideDetailDrawer, UiTabs, useConfirmationDialog } from "../components";
import { preventEnterFormSubmit } from "../formGuards";
import { formatCny, formatCurrencyAmount, formatDate, formatDateTime, moneyText } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission, customerDisplayName, customerLegalName, PAYMENT_VOUCHER_UPLOAD_ACCEPT, PDF_UPLOAD_ACCEPT, uploadFormDataWithProgress, validatePaymentVoucherUploadFile, validatePdfUploadFile } from "../utils";
import { summarizeCurrencyTotals, type CurrencyTotals } from "../../lib/platform/currency-totals";
import styles from "../WorkspaceShell.module.css";
import {
  LOGISTICS_COST_TYPE_OPTIONS,
  LOGISTICS_COST_TYPES,
  LOGISTICS_USD_COST_TYPES,
  logisticsCostTypeLabel,
} from "../../lib/platform/logistics-cost-types";

const QUICK_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款", "银行手续费", "样品费", "国外佣金", "国外代理费", "佣金", "其他费用"];
const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
const COST_INVOICE_STATUSES = ["未收到", "已收到"];
const COST_CONFIRMATION_OPTIONS = [
  { label: "未确认", value: "false" },
  { label: "已确认", value: "true" },
];
const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
const FOREIGN_CURRENCY_COST_TYPES = ["国外佣金", "国外代理费", "佣金", ...LOGISTICS_USD_COST_TYPES];
const FACTORY_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款"];
const PRODUCT_SUPPLIER_TYPES = ["产品供应商", "工厂供应商"];
const LOGISTICS_INVOICE_COST_TYPES = [...LOGISTICS_COST_TYPES, "国内物流费", "国内拖车费"];
const COST_FILTER_TYPES = [...QUICK_COST_TYPES, ...LOGISTICS_COST_TYPES]
  .filter((type, index, rows) => rows.indexOf(type) === index);
const COST_FILTER_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  LOGISTICS_COST_TYPE_OPTIONS.map((item) => [item.value, item.label]),
);
const DISABLE_COMPONENT_RENDER = [
  "OrderPayableSummary",
  "RmbSummaryBlock",
  "UsdSummaryBlock",
  "ExchangeSummaryBlock",
] as const;
void DISABLE_COMPONENT_RENDER;
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
  paid?: boolean;
  paidAt?: string;
  paymentVoucherUrl?: string;
  paymentVoucherFileName?: string;
  paymentVoucherMimeType?: string;
  paymentVoucherUploadedAt?: string;
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
  invoiceExceptionType?: string;
  invoiceExceptionLabel?: string;
};

type CostInvoiceGroupRow = {
  id: string;
  groupKey?: string;
  groupType?: string;
  logisticsBillId?: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerFullName?: string;
  customerShortName?: string;
  supplierId?: string;
  supplierName?: string;
  supplierNameSnapshot?: string;
  vendorName?: string;
  invoiceNo?: string;
  costTypes?: string[];
  costTypeSummary?: string;
  currencyTotals?: CurrencyTotals;
  paymentStatus?: string;
  invoiceStatus?: string;
  invoiceExceptionType?: string;
  invoiceExceptionLabel?: string;
  costCount?: number;
  costs?: CostRow[];
  documents?: CostDocument[];
  updatedAt?: string;
  sourceType?: string;
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
  rows: CostRow[] | CostOrderSummary[] | CostInvoiceGroupRow[];
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

type CostDeleteResponse = {
  success?: boolean;
  ok?: boolean;
  message?: string;
  action?: "deleted" | "voided";
  cost?: CostRow;
  orderSummary?: CostOrderSummary | null;
};

type CostPaymentResponse = {
  success?: boolean;
  cost?: CostRow;
  data?: {
    cost?: CostRow;
  };
  message?: string;
};

type PaymentVoucherPreviewState = "checking" | "ready" | "failed";
type PaymentVoucherPreviewKind = "image" | "pdf";

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
  currencyTotals?: CurrencyTotals;
  costCount?: number;
  costs?: CostRow[];
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
type CostView = "invoiceGroups" | "details" | "orders" | "invoiceExceptions";

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

function CostFormDrawer({
  drawer,
  canManageFactoryPayments,
  onCancel,
  onSaved,
}: {
  drawer: CostFormDrawerState;
  canManageFactoryPayments: boolean;
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
    ? `成本类型：${logisticsCostTypeLabel(cost?.costType || "") || cost?.costType || "-"} · 付款状态：${cost?.paymentStatus || "-"} · 供应商：${supplierName}`
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
        canManageFactoryPayments={canManageFactoryPayments}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    </SideDetailDrawer>
  );
}

function QuickCreateCostPanel({
  initialCost,
  canManageFactoryPayments = false,
  drawerMode = false,
  onCancel,
  onSaved,
}: {
  initialCost?: CostRow | null;
  canManageFactoryPayments?: boolean;
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
      supplierId: FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && !PRODUCT_SUPPLIER_TYPES.includes(selectedSupplier.supplierType) ? "" : row.supplierId,
    } : row));
    if (FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && !PRODUCT_SUPPLIER_TYPES.includes(selectedSupplier.supplierType)) {
      setMessage("当前成本类型需要选择产品供应商，请重新选择供应商。");
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
      const selectedSupplier = supplierOptions.find((supplier) => supplier.id === item.supplierId) || null;
      if (!isProductSupplierPaymentFormLocked(item, selectedSupplier, canManageFactoryPayments) && item.paymentStatus === "已支付" && !item.paymentDate) {
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
    <form className={`${styles.quickCreatePanel} ${drawerMode ? styles.quickCreatePanelInDrawer : ""}`} onKeyDown={preventEnterFormSubmit} onSubmit={submitQuickCost}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{editMode ? "编辑成本" : "批量登记成本"}</strong>
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
          const paymentLocked = isProductSupplierPaymentFormLocked(item, selectedSupplier, canManageFactoryPayments);
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
                    placeholder={FACTORY_COST_TYPES.includes(item.costType) ? "输入产品供应商 / 开票名称 / 税号" : "输入供应商 / 类型 / 开票名称 / 税号"}
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
                  <select value={item.paymentStatus} disabled={paymentLocked} onChange={(event) => setItemValue(item.localId, "paymentStatus", event.target.value)}>
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
                      disabled={paymentLocked}
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
  onOpenPaymentVoucher,
}: {
  cost: CostRow;
  onViewDetail: () => void;
  deleting: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  return (
    <>
      <tr className={styles.clickableRow} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{cost.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(cost)}>{customerDisplayName(cost)}</td>
        <td>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"}</td>
        <td className={styles.supplierColumn} title={supplierName}>{supplierName}</td>
        <td className={styles.amountColumn}><MoneyAmount currency={cost.currency} amount={cost.amount} amountCny={cost.amountCny} /></td>
        <td><span className={`${styles.statusPill} ${cost.paymentStatus === "已支付" ? styles.statusSuccess : styles.statusWarning}`}>{cost.paymentStatus || "-"}</span></td>
        <td><span className={`${styles.statusPill} ${cost.invoiceStatus === "已收到" ? styles.statusSuccess : styles.statusMuted}`}>{cost.invoiceStatus || "-"}</span></td>
        <td className={styles.costInvoiceActionColumn}>
          <CostInvoiceActions cost={cost} onOpenDocuments={onOpenDocuments} onOpenPaymentVoucher={onOpenPaymentVoucher} />
        </td>
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
        <th className={styles.supplierColumn}>供应商</th>
        <th className={styles.amountColumn}>成本金额</th>
        <th>付款状态</th>
        <th>发票状态</th>
        <th className={styles.costInvoiceActionColumn}>操作</th>
      </tr>
    </thead>
  );
}

function CostInvoiceGroupTableHead({ showException }: { showException: boolean }) {
  return (
    <thead>
      <tr>
        <th className={styles.orderNoColumn}>订单号</th>
        <th className={styles.customerColumn}>客户简称</th>
        <th className={styles.supplierColumn}>供应商</th>
        <th className={styles.amountColumn}>CNY 合计</th>
        <th className={styles.amountColumn}>USD 合计</th>
        <th className={styles.statusColumn}>付款状态</th>
        <th className={styles.statusColumn}>发票状态</th>
        {showException ? <th className={styles.statusColumn}>异常类型</th> : null}
        <th className={styles.costInvoiceActionColumn}>操作</th>
      </tr>
    </thead>
  );
}

function CostInvoiceGroupRows({
  group,
  showException,
  onViewDetail,
  onOpenDocuments,
  onOpenPaymentVoucher,
}: {
  group: CostInvoiceGroupRow;
  showException: boolean;
  onViewDetail: () => void;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  const supplierName = group.supplierName || group.supplierNameSnapshot || group.vendorName || "-";
  const exceptionLabel = group.invoiceExceptionLabel || "";
  const voucherCost = singlePaymentVoucherCost(group.costs || []);
  return (
    <tr className={styles.clickableRow} onClick={onViewDetail}>
      <td className={styles.orderNoColumn}><strong>{group.orderNo || "-"}</strong></td>
      <td className={styles.customerColumn} title={customerLegalName(group)}>{customerDisplayName(group)}</td>
      <td className={styles.supplierColumn} title={supplierName}>{supplierName}</td>
      <td className={styles.amountColumn}>
        <strong className={styles.costAmountTotal}>{formatCurrencyAmount("CNY", currencyTotalAmount(group.currencyTotals, "CNY"))}</strong>
      </td>
      <td className={styles.amountColumn}>
        <strong className={styles.costAmountTotal}>{formatCurrencyAmount("USD", currencyTotalAmount(group.currencyTotals, "USD"))}</strong>
      </td>
      <td className={styles.statusColumn}><span className={costPaymentStatusClass(group.paymentStatus)}>{group.paymentStatus || "-"}</span></td>
      <td className={styles.statusColumn}><span className={costInvoiceStatusClass(group.invoiceStatus)}>{group.invoiceStatus || "-"}</span></td>
      {showException ? (
        <td className={styles.statusColumn}>
          <span className={`${styles.statusPill} ${exceptionLabel === "已付款未收票" ? styles.statusWarning : styles.statusMuted}`}>{exceptionLabel || "-"}</span>
        </td>
      ) : null}
      <td className={styles.costInvoiceActionColumn}>
        <div className={styles.costInvoiceActions}>
          <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button>
          {voucherCost ? (
            <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenPaymentVoucher(voucherCost); }}>查看付款凭证</button>
          ) : null}
          <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>资料维护</button>
        </div>
      </td>
    </tr>
  );
}

function CostOrderTableHead() {
  return (
    <thead>
      <tr>
        <th className={styles.orderNoColumn}>订单号 / Shipment</th>
        <th className={styles.customerColumn}>客户简称</th>
        <th className={styles.amountColumn}>CNY 合计</th>
        <th className={styles.amountColumn}>USD 合计</th>
        <th className={styles.statusColumn}>状态</th>
        <th className={styles.operationColumn}>详情</th>
      </tr>
    </thead>
  );
}

function costViewColSpan(costView: CostView) {
  if (costView === "orders") return 6;
  if (costView === "invoiceGroups") return 8;
  if (costView === "invoiceExceptions") return 9;
  return 8;
}

function costViewLabel(costView: CostView) {
  if (costView === "invoiceGroups") return "发票组";
  if (costView === "orders") return "订单成本汇总";
  if (costView === "invoiceExceptions") return "发票异常组";
  return "成本明细";
}

function costPaymentStatusClass(status = "") {
  return `${styles.statusPill} ${status === "已支付" ? styles.statusSuccess : status === "部分支付" ? styles.statusWarning : styles.statusMuted}`;
}

function costInvoiceStatusClass(status = "") {
  return `${styles.statusPill} ${status === "已收到" ? styles.statusSuccess : status === "部分收到" ? styles.statusWarning : styles.statusMuted}`;
}

function CostOrderSummaryRows({
  order,
  onViewDetail,
}: {
  order: CostOrderSummary;
  onViewDetail: () => void;
}) {
  const confirmProgress = order.costConfirmProgress?.text || "无成本";
  return (
    <>
      <tr className={styles.clickableRow} onClick={onViewDetail}>
        <td className={styles.orderNoColumn}><strong>{order.orderNo || "-"}</strong></td>
        <td className={styles.customerColumn} title={customerLegalName(order)}>{customerDisplayName(order)}</td>
        <td className={styles.amountColumn}>
          <CostOrderAmountCell order={order} currency="CNY" fallback={order.totalCostCny} />
        </td>
        <td className={styles.amountColumn}>
          <CostOrderAmountCell order={order} currency="USD" />
        </td>
        <td className={styles.statusColumn}><span className={styles.statusPill}>{confirmProgress}</span></td>
        <td className={styles.operationColumn}><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(); }}>详情</button></td>
      </tr>
    </>
  );
}

function CostOrderAmountCell({
  order,
  currency,
  fallback = 0,
}: {
  order: CostOrderSummary;
  currency: "CNY" | "USD";
  fallback?: number;
}) {
  const amount = currencyTotalAmount(order.currencyTotals, currency, fallback);
  return (
    <div className={styles.costAmountStack}>
      <strong className={styles.costAmountTotal}>{formatCurrencyAmount(currency, amount)}</strong>
    </div>
  );
}

function recalculateOrderSummary(order: CostOrderSummary, costs: CostRow[]): CostOrderSummary {
  const activeCosts = costs.filter((cost) => Boolean(cost.id));
  const currencyTotals = summarizeCurrencyTotals(activeCosts);
  const confirmed = activeCosts.filter((cost) => cost.costConfirmed).length;
  const documentProgress = activeCosts.reduce((acc, cost) => {
    const successDocs = (cost.documents || []).filter((document) => document.uploadStatus === "SUCCESS");
    if (isFactoryCost(cost)) {
      FACTORY_DOCUMENT_TYPES.forEach((type) => {
        acc.total += 1;
        if (successDocs.some((document) => document.documentType === type.value)) acc.completed += 1;
      });
    } else if (isLogisticsInvoiceCost(cost)) {
      acc.total += 1;
      if (successDocs.some((document) => document.documentType === "SUPPLIER_INVOICE")) acc.completed += 1;
    }
    return acc;
  }, { completed: 0, total: 0 });
  return {
    ...order,
    costs: activeCosts,
    costCount: activeCosts.length,
    totalCostCny: currencyTotals.totalCny,
    currencyTotals,
    costConfirmProgress: {
      completed: confirmed,
      total: activeCosts.length,
      text: activeCosts.length ? `${confirmed}/${activeCosts.length}` : "无成本",
    },
    documentProgress: {
      ...documentProgress,
      text: documentProgress.total ? `${documentProgress.completed}/${documentProgress.total}` : "无需资料",
    },
  };
}

function CostDetailDrawer({
  cost,
  deleting,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onEdit,
  onDelete,
  onClose,
}: {
  cost: CostRow;
  deleting: boolean;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
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
      subtitle={`成本类型：${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} · 付款状态：${cost.paymentStatus || "-"} · 供应商：${supplierName}`}
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
          <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
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
          {isProductSupplierPaymentEnabled(cost) ? (
            <>
              <DetailField label="产品货款付款" value={isProductSupplierPaid(cost) ? "已付款" : "未付款"} />
              <DetailField label="付款时间" value={formatDateTime(cost.paidAt || cost.paymentDate)} />
              <DetailField
                label="付款凭证"
                value={hasPaymentVoucher(cost)
                  ? <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>查看付款凭证</button>
                  : isProductSupplierPaid(cost) ? "未上传水单" : "-"}
              />
            </>
          ) : null}
          <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
          <DetailMoneyField label="付款金额" cost={cost} />
        </div>
      ) : null}
      {activeTab === "invoice" ? (
        <div className={styles.detailGrid}>
          <DetailField label="发票状态" value={cost.invoiceStatus || "-"} />
          <DetailField label="供应商" value={supplierName} />
          <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
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
  onOpenDocuments,
  onOpenPaymentVoucher,
  deletingId,
  onDelete,
  onClose,
}: {
  order: CostOrderSummary;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  deletingId: string;
  onDelete: (cost: CostRow) => void;
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
    >
      <div className={styles.detailGrid}>
        <DetailField label="客户全称" value={customerLegalName(order)} wide />
        <DetailField label="订单号" value={order.orderNo || "-"} />
        <DetailField label="提单号" value={order.blNo || order.billOfLadingNo || "-"} />
        <DetailField label="最终应收" value={formatCny(Number(order.receivableAmountCny || 0))} />
        <DetailField label="成本确认" value={confirmProgress} />
        <DetailField label="资料状态" value={documentProgress} />
        <DetailField label="成本条数" value={String(Number(order.costCount || 0))} />
      </div>
      <CostOrderItemsTable
        costs={order.costs || []}
        deletingId={deletingId}
        onOpenDocuments={onOpenDocuments}
        onOpenPaymentVoucher={onOpenPaymentVoucher}
        onDelete={onDelete}
      />
    </SideDetailDrawer>
  );
}

function CostOrderItemsTable({
  costs,
  deletingId,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onDelete,
}: {
  costs: CostRow[];
  deletingId: string;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onDelete: (cost: CostRow) => void;
}) {
  return (
    <div className={styles.logisticsDrawerSection}>
      <div className={styles.logisticsDrawerSectionHeader}>
        <div>
          <strong>费用明细</strong>
          <span>{costs.length} 项</span>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>成本类型</th>
              <th className={styles.supplierColumn}>供应商</th>
              <th>币种</th>
              <th className={styles.amountColumn}>原币金额</th>
              <th>付款状态</th>
              <th>发票状态</th>
              <th className={styles.costInvoiceActionColumn}>操作</th>
            </tr>
          </thead>
          <tbody>
            {costs.length ? costs.map((cost) => (
              <tr key={cost.id}>
                <td>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"}</td>
                <td className={styles.supplierColumn} title={costSupplierName(cost)}>{costSupplierName(cost)}</td>
                <td>{String(cost.currency || "CNY").toUpperCase()}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount(cost.currency || "CNY", cost.amount ?? cost.amountCny ?? 0)}</td>
                <td><span className={`${styles.statusPill} ${cost.paymentStatus === "已支付" ? styles.statusSuccess : styles.statusWarning}`}>{cost.paymentStatus || "-"}</span></td>
                <td><span className={`${styles.statusPill} ${cost.invoiceStatus === "已收到" ? styles.statusSuccess : styles.statusMuted}`}>{cost.invoiceStatus || "-"}</span></td>
                <td className={styles.costInvoiceActionColumn}>
                  <div className={styles.costInvoiceActions}>
                    <CostInvoiceActions cost={cost} onOpenDocuments={() => onOpenDocuments(cost.id)} onOpenPaymentVoucher={onOpenPaymentVoucher} />
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={deletingId === cost.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(cost);
                      }}
                    >
                      {deletingId === cost.id ? "删除中..." : "删除"}
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={7}><div className={styles.emptyState}>暂无成本明细</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CostInvoiceGroupDrawer({
  group,
  onOpenDocuments,
  onOpenPaymentVoucher,
  onClose,
}: {
  group: CostInvoiceGroupRow;
  onOpenDocuments: (costId: string) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState("basic");
  const supplierName = group.supplierName || group.supplierNameSnapshot || group.vendorName || "-";
  const costs = group.costs || [];
  const documents = group.documents || [];
  const singleManualCost = group.groupType !== "LOGISTICS_BILL" && costs.length === 1;

  useEffect(() => {
    setActiveTab("basic");
  }, [group.id]);

  return (
    <SideDetailDrawer
      ariaLabel="发票组详情"
      kicker="成本管理"
      title={`${group.orderNo || "-"} · ${customerLegalName(group)}`}
      subtitle={`供应商：${supplierName} · 费用类型：${group.costTypeSummary || "-"} · 发票状态：${group.invoiceStatus || "-"}`}
      onClose={onClose}
      actions={
        singleManualCost ? (
          <button className={styles.primaryButtonCompact} type="button" onClick={() => onOpenDocuments(costs[0].id)}>资料维护</button>
        ) : null
      }
    >
      {group.groupType === "LOGISTICS_BILL" ? (
        <div className={styles.infoStrip}>该组来自物流费用分组开票。成本管理只同步展示发票、付款和异常结果，不再按单条费用维护物流发票。</div>
      ) : null}
      <UiTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: "basic", label: "基础信息" },
          { key: "items", label: "费用明细" },
          { key: "documents", label: "发票资料" },
        ]}
      />
      {activeTab === "basic" ? (
        <>
          <div className={styles.detailGrid}>
            <DetailField label="订单号" value={group.orderNo || "-"} />
            <DetailField label="客户全称" value={customerLegalName(group)} wide />
            <DetailField label="提单号" value={group.blNo || group.billOfLadingNo || "-"} />
            <DetailField label="供应商" value={supplierName} />
            <DetailField label="发票号 / 文件" value={group.invoiceNo || "-"} wide />
            <DetailField label="包含费用类型" value={group.costTypeSummary || "-"} wide />
            <DetailField label="付款状态" value={group.paymentStatus || "-"} />
            <DetailField label="发票状态" value={group.invoiceStatus || "-"} />
            {group.invoiceExceptionLabel ? <DetailField label="异常类型" value={group.invoiceExceptionLabel} /> : null}
            <DetailField label="费用明细数" value={`${group.costCount || costs.length} 项`} />
          </div>
          <CostInvoiceGroupTotals group={group} />
        </>
      ) : null}
      {activeTab === "items" ? <CostInvoiceGroupItemsTable costs={costs} onOpenPaymentVoucher={onOpenPaymentVoucher} /> : null}
      {activeTab === "documents" ? (
        <CostInvoiceGroupDocuments
          documents={documents}
          groupType={group.groupType}
          onOpenManualDocuments={singleManualCost ? () => onOpenDocuments(costs[0].id) : undefined}
        />
      ) : null}
    </SideDetailDrawer>
  );
}

function CostInvoiceGroupTotals({ group }: { group: Pick<CostInvoiceGroupRow, "currencyTotals"> }) {
  const cnyTotal = currencyTotalAmount(group.currencyTotals, "CNY");
  const usdTotal = currencyTotalAmount(group.currencyTotals, "USD");
  return (
    <div className={styles.documentGroupGrid}>
      <div className={styles.documentGroupCard}>
        <strong>CNY 合计</strong>
        <span className={styles.costAmountTotal}>{formatCurrencyAmount("CNY", cnyTotal)}</span>
      </div>
      <div className={styles.documentGroupCard}>
        <strong>USD 合计</strong>
        <span className={styles.costAmountTotal}>{formatCurrencyAmount("USD", usdTotal)}</span>
      </div>
    </div>
  );
}

function CostInvoiceGroupItemsTable({
  costs,
  onOpenPaymentVoucher,
}: {
  costs: CostRow[];
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  return (
    <div className={styles.logisticsDrawerSection}>
      <div className={styles.logisticsDrawerSectionHeader}>
        <div>
          <strong>费用明细</strong>
          <span>{costs.length} 项</span>
        </div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>费用类型</th>
              <th className={styles.supplierColumn}>供应商</th>
              <th>币种</th>
              <th className={styles.amountColumn}>原币金额</th>
              <th className={styles.amountColumn}>折人民币</th>
              <th>付款状态</th>
              <th>付款凭证</th>
              <th>发票状态</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {costs.length ? costs.map((cost) => (
              <tr key={cost.id}>
                <td>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"}</td>
                <td className={styles.supplierColumn} title={costSupplierName(cost)}>{costSupplierName(cost)}</td>
                <td>{String(cost.currency || "CNY").toUpperCase()}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount(cost.currency || "CNY", cost.amount ?? cost.amountCny ?? 0)}</td>
                <td className={styles.amountColumn}>{formatCurrencyAmount("CNY", cost.amountCny ?? 0)}</td>
                <td><span className={costPaymentStatusClass(cost.paymentStatus)}>{cost.paymentStatus || "-"}</span></td>
                <td>
                  {hasPaymentVoucher(cost) ? (
                    <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>查看付款凭证</button>
                  ) : isProductSupplierPaid(cost) && isProductSupplierPaymentEnabled(cost) ? "未上传水单" : "-"}
                </td>
                <td><span className={costInvoiceStatusClass(cost.invoiceStatus)}>{cost.invoiceStatus || "-"}</span></td>
                <td title={cost.remark || ""}>{cost.remark || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan={9}><div className={styles.emptyState}>暂无费用明细</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CostInvoiceGroupDocuments({
  documents,
  groupType,
  onOpenManualDocuments,
}: {
  documents: CostDocument[];
  groupType?: string;
  onOpenManualDocuments?: () => void;
}) {
  return (
    <div className={styles.documentGroupCard}>
      <strong>整组发票资料</strong>
      {groupType === "LOGISTICS_BILL" ? (
        <span className={styles.mutedText}>物流发票按物流费用模块的分组开票入口上传，成本管理仅同步展示该组结果。</span>
      ) : null}
      {documents.length ? documents.map((document) => (
        <div key={document.id} className={styles.fileListItem}>
          <div>
            <span>{document.fileName || "-"}</span>
            <small>{document.uploadedByName || "-"} ｜ {formatDate(document.uploadedAt)}</small>
          </div>
          <div className={styles.fileListItemActions}>
            <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
          </div>
        </div>
      )) : <div className={styles.emptyState}>暂未收到整组发票资料</div>}
      {onOpenManualDocuments ? (
        <button className={styles.primaryButtonCompact} type="button" onClick={onOpenManualDocuments}>维护整组发票资料</button>
      ) : null}
    </div>
  );
}

function CostInvoiceActions({
  cost,
  onOpenDocuments,
  onOpenPaymentVoucher,
}: {
  cost: CostRow;
  onOpenDocuments: () => void;
  onOpenPaymentVoucher?: (cost: CostRow) => void;
}) {
  const invoiceReceived = cost.invoiceStatus === "已收到";
  const logisticsGenerated = isLogisticsGeneratedCost(cost);
  const voucherAvailable = hasPaymentVoucher(cost);
  return (
    <div className={styles.costInvoiceActions}>
      {logisticsGenerated ? (
        invoiceReceived ? (
          <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>查看发票</button>
        ) : (
          <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>查看说明</button>
        )
      ) : invoiceReceived ? (
        <>
          <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>查看发票</button>
          <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>替换</button>
        </>
      ) : (
        <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenDocuments(); }}>上传发票</button>
      )}
      {voucherAvailable && onOpenPaymentVoucher ? (
        <button className={styles.secondaryButton} type="button" onClick={(event) => { event.stopPropagation(); onOpenPaymentVoucher(cost); }}>查看付款凭证</button>
      ) : null}
    </div>
  );
}

function CostDocumentsDrawer({
  cost,
  loading,
  error,
  uploadingKey,
  uploadProgressByKey,
  deletingDocumentId,
  canWriteDocuments,
  canManageFactoryPayments,
  paymentSavingId,
  voucherUploadingKey,
  onClose,
  onUpload,
  onUpdatePayment,
  onUploadPaymentVoucher,
  onOpenPaymentVoucher,
  onDelete,
}: {
  cost: CostRow;
  loading: boolean;
  error: string;
  uploadingKey: string;
  uploadProgressByKey: Record<string, number>;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  canManageFactoryPayments: boolean;
  paymentSavingId: string;
  voucherUploadingKey: string;
  onClose: () => void;
  onUpload: (cost: CostRow, documentType: string, file: File | null) => void;
  onUpdatePayment: (cost: CostRow, paid: boolean, paidAt: string) => void;
  onUploadPaymentVoucher: (cost: CostRow, file: File | null) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
  onDelete: (cost: CostRow, document: CostDocument) => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const documentTypes = costDocumentTypesForDrawer(cost);
  const paymentVoucherKey = paymentVoucherUploadKey(cost);
  const paymentEnabled = isProductSupplierPaymentEnabled(cost);
  const dismissConfirmMessage = uploadingKey || voucherUploadingKey ? "当前内容尚未保存，确定关闭吗？" : "";
  const logisticsGenerated = isLogisticsGeneratedCost(cost);
  const canManageDocuments = canWriteDocuments && !logisticsGenerated;
  const readOnlyReason = logisticsGenerated
    ? "该成本来自物流费用审核，发票按物流费用模块的分组开票规则上传；成本管理仅同步查看，不能在这里上传、替换或删除。"
    : "";

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
            <small>{logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} · 提单号：{cost.blNo || cost.billOfLadingNo || "-"}</small>
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
                <DetailField label="成本类型" value={logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} />
                <DetailField label="成本金额" value={moneyText(cost.currency, cost.amount, cost.amountCny)} />
                <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
                <DetailField label="发票状态" value={cost.invoiceStatus || "-"} />
              </div>
            </div>
            <div className={styles.documentGroupCard}>
              <strong>资料要求</strong>
              <span className={styles.mutedText}>
                {logisticsGenerated ? "物流费用发票以发票分组为准：报关费、港杂费、海运费、拖车及其他费用合并发票。成本管理只展示同步结果。"
                  : isFactoryCost(cost) ? "产品供应商需维护采购合同和增值税发票。"
                    : isLogisticsInvoiceCost(cost) ? "客户指定临时货代或手工录入的物流成本，可在成本管理维护对应物流发票。"
                      : "当前成本可维护一份发票资料。"}
              </span>
            </div>
          </div>
          <div className={styles.documentGroupCard}>
            <strong>资料维护</strong>
            {readOnlyReason ? <div className={styles.infoStrip}>{readOnlyReason}</div> : null}
            {paymentEnabled ? (
              <ProductSupplierPaymentPanel
                cost={cost}
                canManage={canManageFactoryPayments}
                saving={paymentSavingId === cost.id}
                voucherUploading={voucherUploadingKey === paymentVoucherKey}
                voucherProgress={uploadProgressByKey[paymentVoucherKey] || 0}
                onUpdatePayment={onUpdatePayment}
                onUploadPaymentVoucher={onUploadPaymentVoucher}
                onOpenPaymentVoucher={onOpenPaymentVoucher}
              />
            ) : null}
            {documentTypes.map((documentType) => (
              <CostDocumentUploadItem
                key={`${cost.id}-${documentType.value}`}
                cost={cost}
                documentType={documentType}
                documents={documentsForType(cost, documentType.value)}
                uploading={uploadingKey === costUploadKey(cost, documentType.value)}
                uploadProgress={uploadProgressByKey[costUploadKey(cost, documentType.value)] || 0}
                deletingDocumentId={deletingDocumentId}
                canWriteDocuments={canManageDocuments}
                readOnlyReason={readOnlyReason}
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

function ProductSupplierPaymentPanel({
  cost,
  canManage,
  saving,
  voucherUploading,
  voucherProgress,
  onUpdatePayment,
  onUploadPaymentVoucher,
  onOpenPaymentVoucher,
}: {
  cost: CostRow;
  canManage: boolean;
  saving: boolean;
  voucherUploading: boolean;
  voucherProgress: number;
  onUpdatePayment: (cost: CostRow, paid: boolean, paidAt: string) => void;
  onUploadPaymentVoucher: (cost: CostRow, file: File | null) => void;
  onOpenPaymentVoucher: (cost: CostRow) => void;
}) {
  const paid = isProductSupplierPaid(cost);
  const [paidAtInput, setPaidAtInput] = useState(() => dateTimeLocalValue(cost.paidAt || cost.paymentDate || undefined));
  const voucherLabel = cost.paymentVoucherFileName ? "查看付款凭证" : paid ? "未上传水单" : "未上传";

  useEffect(() => {
    setPaidAtInput(dateTimeLocalValue(cost.paidAt || cost.paymentDate || undefined));
  }, [cost.id, cost.paidAt, cost.paymentDate]);

  function submitPaid() {
    const nextPaidAt = dateTimeLocalToIso(paidAtInput || dateTimeLocalValue());
    onUpdatePayment(cost, true, nextPaidAt);
  }

  return (
    <div className={styles.fileListItem}>
      <div>
        <span>产品货款付款</span>
        <small>{paid ? `已付款 ｜ ${formatDateTime(cost.paidAt || cost.paymentDate)}` : "未付款，可先不上传凭证"}</small>
        <small>
          付款凭证：{hasPaymentVoucher(cost)
            ? <button className={styles.fileActionButton} type="button" onClick={() => onOpenPaymentVoucher(cost)}>{voucherLabel}</button>
            : voucherLabel}
        </small>
      </div>
      <div className={styles.fileListItemActions}>
        {canManage ? (
          <>
            <label>
              <span className={styles.mutedText}>付款时间</span>
              <input
                className={styles.uiInput}
                type="datetime-local"
                value={paidAtInput}
                disabled={saving}
                onChange={(event) => setPaidAtInput(event.target.value)}
              />
            </label>
            <button className={paid ? styles.secondaryButton : styles.primaryButtonCompact} type="button" disabled={saving} onClick={submitPaid}>
              {saving ? "保存中..." : paid ? "更新付款时间" : "标记已付款"}
            </button>
            {paid ? (
              <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => onUpdatePayment(cost, false, "")}>
                取消付款
              </button>
            ) : null}
            <label className={styles.secondaryButton}>
              {voucherUploading ? "上传中..." : cost.paymentVoucherFileName ? "更换付款凭证" : "上传付款凭证"}
              <input
                type="file"
                accept={PAYMENT_VOUCHER_UPLOAD_ACCEPT}
                disabled={voucherUploading}
                hidden
                onChange={(event) => {
                  onUploadPaymentVoucher(cost, event.target.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {voucherUploading ? <UploadProgressInline progress={voucherProgress} /> : null}
          </>
        ) : (
          <span className={styles.mutedText}>只读</span>
        )}
      </div>
    </div>
  );
}

function PaymentVoucherPreviewModal({
  cost,
  onClose,
}: {
  cost: CostRow;
  onClose: () => void;
}) {
  const [previewState, setPreviewState] = useState<PaymentVoucherPreviewState>("checking");
  const [previewKind, setPreviewKind] = useState<PaymentVoucherPreviewKind>(() => inferPaymentVoucherPreviewKind(cost) || "image");
  const previewUrl = paymentVoucherDownloadUrl(cost);
  const downloadUrl = paymentVoucherDownloadUrl(cost, "attachment");
  const supplierName = costSupplierName(cost);

  useEffect(() => {
    let cancelled = false;

    async function verifyPreview() {
      setPreviewState("checking");
      const inferredKind = inferPaymentVoucherPreviewKind(cost);
      if (!previewUrl) {
        setPreviewState("failed");
        return;
      }
      try {
        const response = await fetch(previewUrl, {
          method: "HEAD",
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("preview unavailable");
        const contentKind = previewKindFromContentType(response.headers.get("Content-Type") || "") || inferredKind;
        if (!contentKind) throw new Error("unsupported preview type");
        if (!cancelled) {
          setPreviewKind(contentKind);
          setPreviewState("ready");
        }
      } catch {
        if (cancelled) return;
        if (inferredKind) {
          setPreviewKind(inferredKind);
          setPreviewState("ready");
          return;
        }
        setPreviewState("failed");
      }
    }

    void verifyPreview();
    return () => {
      cancelled = true;
    };
  }, [cost.id, cost.paymentVoucherFileName, cost.paymentVoucherMimeType, previewUrl]);

  return (
    <DismissibleLayer
      ariaLabel="付款凭证"
      overlayClassName={styles.modalOverlay}
      surfaceClassName={styles.paymentVoucherModal}
      dismissible
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
          <header className={styles.modalHeader}>
            <div>
              <strong>付款凭证</strong>
              <span>{cost.paymentVoucherFileName || "汇款水单"}</span>
            </div>
            <button className={styles.ghostButton} type="button" onClick={requestClose}>关闭</button>
          </header>
          <div className={styles.paymentVoucherMeta}>
            <span><strong>订单号</strong>{cost.orderNo || "-"}</span>
            <span><strong>供应商</strong>{supplierName}</span>
            <span><strong>付款时间</strong>{formatDateTime(cost.paidAt || cost.paymentDate)}</span>
          </div>
          <div className={styles.paymentVoucherPreviewBody}>
            {previewState === "checking" ? (
              <div className={styles.pdfPreviewLoading}>正在加载付款凭证...</div>
            ) : null}
            {previewState === "ready" && previewKind === "image" ? (
              <div className={styles.paymentVoucherImageFrame}>
                <img
                  src={previewUrl}
                  alt={cost.paymentVoucherFileName || "付款凭证"}
                  onError={() => setPreviewState("failed")}
                />
              </div>
            ) : null}
            {previewState === "ready" && previewKind === "pdf" ? (
              <iframe
                src={previewUrl}
                title="付款凭证"
                className={styles.paymentVoucherFrame}
                onError={() => setPreviewState("failed")}
              />
            ) : null}
            {previewState === "failed" ? (
              <div className={styles.paymentVoucherFallback}>
                文件暂时无法预览，请下载查看。
              </div>
            ) : null}
          </div>
          <footer className={styles.modalFooter}>
            <span aria-hidden="true" />
            <div className={styles.detailActions}>
              <a className={styles.primaryButtonCompact} href={downloadUrl} download>
                下载凭证
              </a>
              <button className={styles.secondaryButton} type="button" onClick={requestClose}>关闭</button>
            </div>
          </footer>
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
  uploadProgress = 0,
  deletingDocumentId,
  canWriteDocuments,
  readOnlyReason,
  onUpload,
  onDelete,
}: {
  cost: CostRow;
  documentType: { value: string; label: string; required?: boolean };
  documents: CostDocument[];
  uploading: boolean;
  uploadProgress?: number;
  deletingDocumentId: string;
  canWriteDocuments: boolean;
  readOnlyReason?: string;
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
          <>
            <label className={styles.secondaryButton}>
              {uploading ? "上传中..." : completed ? "替换/上传PDF" : "选择PDF"}
              <input
                type="file"
                accept={PDF_UPLOAD_ACCEPT}
                disabled={uploading}
                hidden
                onChange={(event) => {
                  onUpload(cost, documentType.value, event.target.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            {uploading ? <UploadProgressInline progress={uploadProgress} /> : null}
          </>
        ) : (
          <span className={styles.mutedText}>{readOnlyReason || "无权限操作"}</span>
        )}
        {documents.map((document) => (
          <span key={document.id} className={styles.fileListItemActions}>
            <PdfPreviewButton documentId={document.id} fileName={document.fileName || ""} />
            <a className={styles.fileActionButton} href={`/api/order-documents/${encodeURIComponent(document.id)}/download`}>下载</a>
            {canWriteDocuments ? (
              <button
                className={styles.fileDangerButton}
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
  return PRODUCT_SUPPLIER_TYPES.includes(cost.supplierType || "") || FACTORY_COST_TYPES.includes(cost.costType || "");
}

function isLogisticsInvoiceCost(cost: CostRow) {
  return LOGISTICS_INVOICE_COST_TYPES.includes(cost.costType || "");
}

function isLogisticsGeneratedCost(cost: Pick<CostRow, "sourceType">) {
  return cost.sourceType === "LOGISTICS_EXPENSE";
}

function isProductSupplierPaymentEnabled(cost: CostRow) {
  return isFactoryCost(cost) && !isLogisticsGeneratedCost(cost) && !isLogisticsInvoiceCost(cost);
}

function isProductSupplierPaid(cost: CostRow) {
  return Boolean(cost.paid) || cost.paymentStatus === "已支付" || cost.paymentStatus === "部分支付";
}

function isProductSupplierPaymentFormLocked(item: Pick<CostItemForm, "costType">, supplier: SupplierOption | null, canManageFactoryPayments: boolean) {
  if (canManageFactoryPayments) return false;
  return FACTORY_COST_TYPES.includes(item.costType) || PRODUCT_SUPPLIER_TYPES.includes(supplier?.supplierType || "");
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

function paymentVoucherUploadKey(cost: CostRow) {
  return [cost.id, "payment-voucher"].join(":");
}

function paymentVoucherDownloadUrl(cost: Pick<CostRow, "id" | "paymentVoucherUrl" | "paymentVoucherFileName">, disposition: "inline" | "attachment" = "inline") {
  const baseUrl = cost.paymentVoucherUrl || (cost.paymentVoucherFileName ? `/api/costs/${encodeURIComponent(cost.id)}/payment-voucher/download` : "");
  if (!baseUrl || disposition === "inline") return baseUrl;
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}download=1`;
}

function hasPaymentVoucher(cost: Pick<CostRow, "id" | "paymentVoucherUrl" | "paymentVoucherFileName">) {
  return Boolean(paymentVoucherDownloadUrl(cost));
}

function singlePaymentVoucherCost(costs: CostRow[]) {
  const voucherCosts = costs.filter(hasPaymentVoucher);
  return voucherCosts.length === 1 ? voucherCosts[0] : null;
}

function previewKindFromContentType(contentType = ""): PaymentVoucherPreviewKind | null {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("application/pdf")) return "pdf";
  if (normalized.startsWith("image/")) return "image";
  return null;
}

function inferPaymentVoucherPreviewKind(cost: Pick<CostRow, "paymentVoucherFileName" | "paymentVoucherMimeType">): PaymentVoucherPreviewKind | null {
  const mimeKind = previewKindFromContentType(cost.paymentVoucherMimeType || "");
  if (mimeKind) return mimeKind;
  const fileName = String(cost.paymentVoucherFileName || "").toLowerCase();
  if (fileName.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp)$/.test(fileName)) return "image";
  return null;
}

function dateTimeLocalValue(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function dateTimeLocalToIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
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

function costSupplierName(cost: Pick<CostRow, "supplierName" | "supplierNameSnapshot" | "vendorName"> | null | undefined) {
  return cost?.supplierName || cost?.supplierNameSnapshot || cost?.vendorName || "-";
}

function exchangeRateMeta(currency?: string) {
  return (currency || "CNY").toUpperCase() === "CNY" ? "来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000" : "汇率来源：待获取";
}

function currencyTotalAmount(summary: CurrencyTotals | null | undefined, currency: string, fallback = 0) {
  const normalized = String(currency || "CNY").toUpperCase();
  if (normalized === "CNY") return Number(summary?.cnyActual ?? fallback ?? 0);
  return Number((summary?.foreignTotals || []).find((item) => String(item.currency || "").toUpperCase() === normalized)?.amount || 0);
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
