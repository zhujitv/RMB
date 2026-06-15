"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { apiJson } from "../api";
import { DetailField, PaginationBar } from "../components";
import { formatCny, formatDate, moneyText } from "../formatters";
import { SearchAutocomplete } from "../SearchAutocomplete";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import styles from "../WorkspaceShell.module.css";

const QUICK_COST_TYPES = ["工厂货款", "原材料货款", "采购货款", "产品货款", "银行手续费", "样品费", "国外佣金", "国外代理费", "佣金", "其他费用"];
const COST_PAYMENT_STATUSES = ["待支付", "部分支付", "已支付", "已取消"];
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
  rows: CostRow[];
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

type QuickCostForm = {
  orderId: string;
  supplierId: string;
  costType: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  paymentStatus: string;
  costConfirmed: string;
  paymentDate: string;
  remark: string;
};

const PAGE_SIZE = 20;

const emptyQuickCostForm: QuickCostForm = {
  orderId: "",
  supplierId: "",
  costType: "工厂货款",
  amount: "",
  currency: "CNY",
  exchangeRate: "1",
  paymentStatus: "待支付",
  costConfirmed: "false",
  paymentDate: "",
  remark: "",
};

export function CostsModule({
  currentUser,
  permissions,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
}) {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [archiveScope, setArchiveScope] = useState("current");
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editCost, setEditCost] = useState<CostRow | null>(null);
  const [documentCost, setDocumentCost] = useState<CostRow | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const canWriteDocuments = canWritePermission(currentUser, permissions, "documents", ["管理员", "财务", "成本录入员", "业务员"]);

  async function loadCosts(nextPage = page, nextKeyword = submittedKeyword, nextArchiveScope = archiveScope) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        archiveScope: nextArchiveScope,
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<CostsResponse>(`/api/costs?${params}`);
      const data = result.data || { rows: result.costs || [], total: result.costs?.length || 0, page: nextPage, pageSize: PAGE_SIZE };
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotal(Number(data.total || 0));
      setPage(Number(data.page || nextPage));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取成本明细失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCosts(1, "");
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setExpandedId("");
    setNotice("");
    void loadCosts(1, value, archiveScope);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setArchiveScope("current");
    setExpandedId("");
    setNotice("");
    void loadCosts(1, "", "current");
  }

  function gotoPage(nextPage: number) {
    setExpandedId("");
    void loadCosts(nextPage, submittedKeyword, archiveScope);
  }

  function changeArchiveScope(nextArchiveScope: string) {
    setArchiveScope(nextArchiveScope);
    setExpandedId("");
    setNotice("");
    void loadCosts(1, submittedKeyword, nextArchiveScope);
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <span className={styles.kicker}>业务模块</span>
          <h2>成本管理</h2>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.primaryButtonCompact}
            type="button"
            onClick={() => {
              setEditCost(null);
              setCreateOpen((current) => !current);
            }}
          >
            {createOpen ? "收起登记" : "登记成本"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadCosts(page, submittedKeyword, archiveScope);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {createOpen || editCost ? (
        <QuickCreateCostPanel
          initialCost={editCost}
          onCancel={() => {
            setCreateOpen(false);
            setEditCost(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditCost(null);
            setExpandedId("");
            setNotice(editCost ? "成本已更新" : "成本已保存");
            void loadCosts(1, submittedKeyword, archiveScope);
          }}
        />
      ) : null}

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 供应商 / 成本类型"
        />
        <select value={archiveScope} onChange={(event) => changeArchiveScope(event.target.value)} disabled={loading}>
          <option value="current">当前业务</option>
          <option value="archive">已归档业务</option>
          <option value="all">全部业务</option>
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
              <th>成本类型</th>
              <th>供应商</th>
              <th>成本金额</th>
              <th>付款状态</th>
              <th>发票状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : rows.length ? rows.map((cost) => (
              <CostTableRows
                key={cost.id}
                cost={cost}
                expanded={expandedId === cost.id}
                onToggle={() => setExpandedId((current) => current === cost.id ? "" : cost.id)}
                deleting={deletingId === cost.id}
                onEdit={() => {
                  setCreateOpen(false);
                  setEditCost(cost);
                  setExpandedId(cost.id);
                }}
                onDelete={() => void deleteCost(cost)}
                onOpenDocuments={() => void openCostDocuments(cost.id)}
              />
            )) : (
              <tr>
                <td colSpan={8}><div className={styles.emptyState}>未找到匹配的成本明细</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={gotoPage} />

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
    </section>
  );

  async function fetchCostDetail(id: string) {
    const result = await apiJson<CostDetailResponse>(`/api/costs/${encodeURIComponent(id)}`);
    const cost = result.cost || result.data?.cost;
    if (!cost) throw new Error(result.message || "未找到成本详情");
    setRows((current) => current.map((item) => item.id === cost.id ? { ...item, ...cost } : item));
    return cost;
  }

  async function openCostDocuments(id: string) {
    const cached = rows.find((cost) => cost.id === id) || null;
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
    if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
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
    if (!window.confirm(`确认删除该资料？\n\n文件：${document.fileName || "-"}`)) return;
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
    if (!window.confirm(`确认删除这条成本？\n\n订单：${cost.orderNo || "-"}\n成本：${cost.costType || "-"} ${moneyText(cost.currency, cost.amount, cost.amountCny)}`)) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; ok?: boolean; message?: string }>(`/api/costs/${encodeURIComponent(cost.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "删除成本失败");
      setExpandedId("");
      await loadCosts(page, submittedKeyword, archiveScope);
      setNotice(result.message || "成本已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除成本失败");
    } finally {
      setDeletingId("");
    }
  }
}

function QuickCreateCostPanel({
  initialCost,
  onCancel,
  onSaved,
}: {
  initialCost?: CostRow | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<QuickCostForm>(() => costFormFromRow(initialCost));
  const [orders, setOrders] = useState<CostOrderOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [exchangeMeta, setExchangeMeta] = useState("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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

  async function searchSuppliers(keyword: string) {
    try {
      const params = new URLSearchParams({ status: "active" });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      if (FACTORY_COST_TYPES.includes(form.costType)) params.set("type", "factory");
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

  function handleOrderSelect(order: CostOrderOption) {
    setOrders((current) => current.some((item) => item.id === order.id) ? current : [order, ...current]);
    setFormValue("orderId", order.id);
  }

  function handleSupplierSelect(supplier: SupplierOption) {
    setSuppliers((current) => current.some((item) => item.id === supplier.id) ? current : [supplier, ...current]);
    setFormValue("supplierId", supplier.id);
  }

  async function resolveExchangeRate(currency: string, paymentDate = form.paymentDate) {
    const normalized = currency.trim().toUpperCase();
    if (normalized === "CNY") {
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      setFormValue("exchangeRate", "1");
      return;
    }
    setExchangeMeta("正在获取汇率...");
    try {
      const params = new URLSearchParams({ currency: normalized });
      if (paymentDate) params.set("date", paymentDate);
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${params}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setFormValue("exchangeRate", String(rate));
        setExchangeMeta(`来源：${result.rate?.source || "系统"} ｜ 类型：${result.rate?.rateType || "现汇买入价"} ｜ 更新时间：${result.rate?.rateDate || "-"}`);
      } else {
        setExchangeMeta("汇率来源：待获取，请手工填写");
      }
    } catch (rateError) {
      setExchangeMeta(rateError instanceof Error ? rateError.message : "汇率获取失败，请手工填写");
    }
  }

  async function handleCostTypeChange(costType: string) {
    const currency = FOREIGN_CURRENCY_COST_TYPES.includes(costType) ? form.currency : "CNY";
    setForm((current) => ({
      ...current,
      costType,
      currency,
      exchangeRate: currency === "CNY" ? "1" : "",
      supplierId: FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && selectedSupplier.supplierType !== "工厂供应商"
        ? ""
        : current.supplierId,
    }));
    if (FACTORY_COST_TYPES.includes(costType) && selectedSupplier?.supplierType && selectedSupplier.supplierType !== "工厂供应商") {
      setMessage("当前成本类型需要选择工厂供应商，请重新选择供应商。");
    }
    await resolveExchangeRate(currency);
  }

  async function handleCurrencyChange(currency: string) {
    const normalized = currency.toUpperCase();
    setForm((current) => ({ ...current, currency: normalized, exchangeRate: normalized === "CNY" ? "1" : "" }));
    await resolveExchangeRate(normalized);
  }

  async function submitQuickCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
    if (!form.supplierId) {
      setMessage("请选择供应商");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setMessage("请填写供应商成本金额");
      return;
    }
    if (!form.currency) {
      setMessage("请选择成本币种");
      return;
    }
    if (!Number(form.exchangeRate)) {
      setMessage("请填写汇率；CNY 成本汇率应自动为 1");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const isEdit = Boolean(initialCost?.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/costs/${encodeURIComponent(initialCost?.id || "")}` : "/api/costs",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            orderId: form.orderId,
            supplierId: form.supplierId,
            costType: form.costType,
            amount: Number(form.amount),
            currency: form.currency,
            exchangeRate: Number(form.exchangeRate),
            paymentStatus: form.paymentStatus,
            costConfirmed: form.costConfirmed === "true",
            paymentDate: form.paymentDate || undefined,
            remark: form.remark.trim(),
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "成本保存失败");
      setForm(costFormFromRow(null));
      setExchangeMeta("来源：系统 ｜ 类型：人民币 ｜ 汇率：1.0000");
      onSaved();
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
  const initialSupplier = initialCost?.supplierId ? {
    id: initialCost.supplierId,
    supplierName: initialCost.supplierName || initialCost.supplierNameSnapshot || initialCost.vendorName,
    name: initialCost.supplierName || initialCost.supplierNameSnapshot || initialCost.vendorName,
    supplierType: "",
    invoiceTitle: "",
  } : null;
  const orderOptions = initialOrder && !orders.some((order) => order.id === initialOrder.id) ? [initialOrder, ...orders] : orders;
  const supplierOptions = initialSupplier && !suppliers.some((supplier) => supplier.id === initialSupplier.id) ? [initialSupplier, ...suppliers] : suppliers;
  const selectedOrder = orderOptions.find((order) => order.id === form.orderId);
  const selectedSupplier = supplierOptions.find((supplier) => supplier.id === form.supplierId);
  const forceCny = !FOREIGN_CURRENCY_COST_TYPES.includes(form.costType);

  return (
    <form className={styles.quickCreatePanel} onSubmit={submitQuickCost}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{initialCost?.id ? "编辑成本" : "快速登记成本"}</strong>
          <span>用于登记工厂、物流、报关、港杂、海运等订单成本。</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            cacheKey="cost-orders"
            emptyLabel="未找到订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={(order) => order.customerFullName || order.customerName || "-"}
            search={searchOrders}
            onSelect={handleOrderSelect}
          />
        </label>
        <label>
          供应商
          <SearchAutocomplete
            value={selectedSupplier || null}
            cacheKey={`cost-suppliers:${FACTORY_COST_TYPES.includes(form.costType) ? "factory" : "all"}`}
            emptyLabel="未找到匹配供应商，可先到系统设置新增供应商"
            placeholder={FACTORY_COST_TYPES.includes(form.costType) ? "输入工厂供应商 / 开票名称 / 税号" : "输入供应商 / 类型 / 开票名称 / 税号"}
            getLabel={supplierLabel}
            getDescription={(supplier) => supplier.invoiceTitle || supplier.supplierType || ""}
            search={searchSuppliers}
            onSelect={handleSupplierSelect}
          />
        </label>
        <label>
          成本类型
          <select value={form.costType} onChange={(event) => void handleCostTypeChange(event.target.value)}>
            {QUICK_COST_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label>
          成本金额
          <input value={form.amount} onChange={(event) => setFormValue("amount", event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          币种
          <select value={form.currency} onChange={(event) => void handleCurrencyChange(event.target.value)} disabled={forceCny}>
            {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label>
          汇率
          <input
            value={form.exchangeRate}
            onChange={(event) => setFormValue("exchangeRate", event.target.value)}
            readOnly={form.currency === "CNY"}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          付款状态
          <select value={form.paymentStatus} onChange={(event) => setFormValue("paymentStatus", event.target.value)}>
            {COST_PAYMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          成本确认
          <select value={form.costConfirmed} onChange={(event) => setFormValue("costConfirmed", event.target.value)}>
            {COST_CONFIRMATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          付款日期
          <input value={form.paymentDate} onChange={(event) => setFormValue("paymentDate", event.target.value)} type="date" />
        </label>
        <label>
          备注
          <input value={form.remark} onChange={(event) => setFormValue("remark", event.target.value)} placeholder="可选" />
        </label>
      </div>

      <div className={styles.quickCreateMeta}>
        <span>订单：{selectedOrder ? orderLabel(selectedOrder) : "-"}</span>
        <span>供应商：{selectedSupplier ? supplierLabel(selectedSupplier) : "-"}</span>
        <span>{exchangeMeta}</span>
      </div>

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "保存中..." : initialCost?.id ? "更新成本" : "保存成本"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function CostTableRows({
  cost,
  expanded,
  deleting,
  onToggle,
  onEdit,
  onDelete,
  onOpenDocuments,
}: {
  cost: CostRow;
  expanded: boolean;
  deleting: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenDocuments: () => void;
}) {
  const supplierName = cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-";
  const manualCost = cost.sourceType !== "LOGISTICS_EXPENSE";
  return (
    <>
      <tr className={styles.clickableRow} onClick={onToggle}>
        <td><strong>{cost.orderNo || "-"}</strong></td>
        <td title={cost.customerFullName || cost.customerName || ""}>{cost.customerShortName || cost.customerName || "-"}</td>
        <td>{cost.costType || "-"}</td>
        <td>{supplierName}</td>
        <td>{moneyText(cost.currency, cost.amount, cost.amountCny)}</td>
        <td><span className={`${styles.statusPill} ${cost.paymentStatus === "已支付" ? styles.statusSuccess : styles.statusWarning}`}>{cost.paymentStatus || "-"}</span></td>
        <td><span className={`${styles.statusPill} ${cost.invoiceStatus === "已收到" ? styles.statusSuccess : styles.statusMuted}`}>{cost.invoiceStatus || "-"}</span></td>
        <td><button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onToggle(); }}>{expanded ? "收起" : "详情"}</button></td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={8}>
            <div className={styles.detailCard}>
              <div className={styles.detailActions}>
                <button
                  className={styles.primaryButtonCompact}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDocuments();
                  }}
                >
                  资料维护
                </button>
                {manualCost ? (
                  <>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit();
                      }}
                    >
                      编辑成本
                    </button>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={deleting}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete();
                      }}
                    >
                      {deleting ? "删除中..." : "删除成本"}
                    </button>
                  </>
                ) : (
                  <span className={styles.mutedText}>系统生成的成本记录不可在此直接编辑。</span>
                )}
              </div>
              <div className={styles.detailGrid}>
                <DetailField label="客户全称" value={cost.customerFullName || cost.customerName || "-"} wide />
                <DetailField label="提单号" value={cost.blNo || cost.billOfLadingNo || "-"} />
                <DetailField label="供应商" value={supplierName} />
                <DetailField label="成本确认" value={cost.costConfirmed ? "已确认" : "未确认"} />
                <DetailField label="折人民币" value={formatCny(Number(cost.amountCny || 0))} />
                <DetailField label="币种 / 汇率" value={`${cost.currency || "-"} / ${Number(cost.exchangeRate || 0).toFixed(4)}`} />
                <DetailField label="来源" value={cost.sourceLabel || "人工录入"} />
                <DetailField label="创建人" value={cost.createdBy?.name || "-"} />
                <DetailField label="修改人" value={cost.updatedBy?.name || "-"} />
                <DetailField label="备注" value={cost.remark || "-"} wide hidden={!cost.remark} />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
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

  return (
    <div className={styles.drawerOverlay} role="dialog" aria-modal="true" aria-label="成本资料维护">
      <aside className={styles.taxRefundDrawer}>
        <header className={styles.taxRefundDrawerHeader}>
          <div className={styles.taxRefundDrawerTitle}>
            <span>供应商资料 / 发票资料</span>
            <strong>{cost.orderNo || "-"} · {supplierName}</strong>
            <small>{cost.costType || "-"} · 提单号：{cost.blNo || cost.billOfLadingNo || "-"}</small>
          </div>
          <div className={styles.taxRefundDrawerActions}>
            <button className={styles.ghostButton} type="button" onClick={onClose}>关闭</button>
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
      </aside>
    </div>
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
    supplierId: cost.supplierId || "",
    costType: cost.costType || "工厂货款",
    amount: cost.amount == null ? "" : String(cost.amount),
    currency: cost.currency || "CNY",
    exchangeRate: cost.exchangeRate == null ? "1" : String(cost.exchangeRate),
    paymentStatus: cost.paymentStatus || "待支付",
    costConfirmed: cost.costConfirmed ? "true" : "false",
    paymentDate: cost.paymentDate || "",
    remark: cost.remark || "",
  };
}

function orderLabel(order: CostOrderOption) {
  const customer = order.customerShortName || order.customerName || order.customerFullName || "-";
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}

function supplierLabel(supplier: SupplierOption) {
  const name = supplier.supplierName || supplier.name || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}
