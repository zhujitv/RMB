"use client";

import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, apiJson } from "../api";
import { ConfirmationDialog, DetailField, PaginationBar, PdfPreviewButton, SideDetailDrawer, UiCheckbox, UiTabs, useConfirmationDialog } from "../components";
import { formatAmount, formatDate, formatDateTime } from "../formatters";
import { preventEnterFormSubmit } from "../formGuards";
import { SearchAutocomplete } from "../SearchAutocomplete";
import { customerDisplayName, customerLegalName, downloadBlob, PDF_UPLOAD_ACCEPT, PDF_UPLOAD_MAX_SIZE_LABEL, uploadFormDataWithProgress, validatePdfUploadFile } from "../utils";
import styles from "../WorkspaceShell.module.css";
import {
  LOGISTICS_COST_TYPE_OPTIONS,
  LOGISTICS_COST_TYPES,
  logisticsCostTypeDefaultCurrency,
  logisticsCostTypeLabel,
  logisticsCostTypeLocksCurrency,
} from "../../lib/platform/logistics-cost-types";
import {
  LOGISTICS_BILL_PAY_BUTTON_RULE,
  LOGISTICS_BILL_PAY_DISABLED_TOOLTIP,
  canReviewLogisticsBill,
  canSubmitLogisticsBill,
  logisticsBillDefaultTab,
  logisticsBillDeleteBlockReason,
  logisticsBillEditBlockReason,
  logisticsBillPayState,
} from "../../lib/platform/logistics-bill-state-machine";
import { logisticsInvoiceGroupForExpense, logisticsInvoiceGroupsForExpenses } from "../../lib/platform/logistics-invoice-groups";

const PAGE_SIZE = 20;
const COST_TYPES = [...LOGISTICS_COST_TYPES];
const COST_TYPE_OPTIONS = [...LOGISTICS_COST_TYPE_OPTIONS];
const DEFAULT_BILLING_METHOD = "按柜";
const CURRENCIES = ["CNY", "USD", "EUR", "GBP", "HKD"];
const FOREIGN_CURRENCY_ORDER = ["USD", "EUR", "HKD", "GBP"];
const LOGISTICS_EXPENSE_BILL_SORT_PRIORITY: Record<string, number> = {
  草稿: 10,
  已驳回: 20,
  待审核: 30,
  待开票: 40,
  未通知: 40,
  已通知开票: 40,
  通知失败: 40,
  "待开票 / 通知失败": 40,
  部分未通知: 40,
  部分已通知: 40,
  部分上传发票: 50,
  部分上传: 50,
  部分已上传: 50,
  部分已确认: 50,
  已上传发票: 60,
  已上传: 60,
  已确认发票: 60,
  已确认: 60,
  已开票: 60,
  待付款: 70,
  部分待付款: 70,
  部分付款: 80,
  部分已付款: 80,
  已付款: 90,
  审核通过: 100,
};
const LOGISTICS_FEE_SUPPLIER_TYPES = [
  "物流供应商",
  "报关供应商",
  "海运供应商",
  "港杂费用供应商",
  "LOGISTICS_SUPPLIER",
  "CUSTOMS_SUPPLIER",
  "FREIGHT_FORWARDER",
  "SHIPPING_SUPPLIER",
  "PORT_CHARGES_SUPPLIER",
];
const AUDIT_FILTERS = [
  { label: "全部审核状态", value: "" },
  { label: "草稿", value: "草稿" },
  { label: "待审核", value: "待审核" },
  { label: "审核通过", value: "审核通过" },
  { label: "已驳回", value: "已驳回" },
  { label: "待开票", value: "toInvoice" },
  { label: "已上传发票", value: "uploaded" },
  { label: "已确认发票", value: "confirmedInvoice" },
];
const PAYMENT_STATUSES = ["待开票", "已开票", "待付款", "已付款"];
const PAY_BUTTON_RULE = LOGISTICS_BILL_PAY_BUTTON_RULE;
const PAY_BUTTON_DISABLED_TOOLTIP = LOGISTICS_BILL_PAY_DISABLED_TOOLTIP;
const todayInputInChinaClient = () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

type UserLite = {
  name?: string;
};

type DocumentLite = {
  id?: string;
  fileName?: string;
  originalFilename?: string;
  fileSize?: number;
  uploadedBy?: UserLite;
  uploadedAt?: string | null;
};

type LogisticsExpense = {
  id: string;
  isBill?: boolean;
  isShipment?: boolean;
  isTemporary?: boolean;
  itemCount?: number;
  billCount?: number;
  items?: LogisticsExpense[];
  shipmentNo?: string;
  customer?: string;
  shipmentBillIds?: string[];
  billId?: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  vesselVoyage?: string;
  supplierId?: string;
  supplierName?: string;
  supplierNames?: string[];
  supplierEmail?: string;
  costId?: string;
  costType?: string;
  currency?: string;
  exchangeRate?: number;
  amount?: number;
  amountCny?: number;
  totalCNY?: number;
  totalUSD?: number;
  currencyTotals?: LogisticsExpenseCurrencySummary;
  containerType?: string;
  appliedContainerCount?: number | null;
  billingMethod?: string;
  billingQuantity?: number | null;
  containerScope?: string;
  order?: Partial<ExpenseOrderOption>;
  remark?: string;
  auditStatus?: string;
  invoiceStatus?: string;
  detailInvoiceStatus?: string;
  billInvoiceStatus?: string;
  invoiceGroups?: LogisticsInvoiceGroupSummary[];
  paymentStatus?: string;
  detailPaymentStatus?: string;
  billPaymentStatus?: string;
  submittedAt?: string | null;
  reviewedBy?: UserLite;
  reviewedAt?: string | null;
  rejectedBy?: UserLite | null;
  rejectedAt?: string | null;
  reviewRemark?: string;
  rejectReason?: string;
  invoiceNotifiedAt?: string | null;
  invoiceNotificationError?: string;
  paymentDate?: string | null;
  invoiceDocumentId?: string;
  invoiceDocument?: DocumentLite | null;
  invoiceUploadedBy?: UserLite;
  invoiceUploadedAt?: string | null;
  invoiceConfirmedBy?: UserLite;
  invoiceConfirmedAt?: string | null;
  createdBy?: UserLite;
  updatedBy?: UserLite;
  createdAt?: string;
  updatedAt?: string;
  sourceLabel?: string;
};

type LogisticsInvoiceGroupSummary = {
  key: string;
  label: string;
  costTypes?: readonly string[];
  amountCny?: number;
  currencyTotals?: LogisticsExpenseCurrencySummary;
  itemIds?: string[];
  status?: string;
  uploaded?: boolean;
  confirmed?: boolean;
  failed?: boolean;
  notified?: boolean;
  invoiceDocumentId?: string;
  invoiceNotificationError?: string;
};

type LogisticsExpensesResponse = {
  rows: LogisticsExpense[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
};

type LogisticsStatementRow = {
  supplierId?: string;
  supplierName?: string;
  orderCount?: number;
  approvedCurrencyTotals?: LogisticsExpenseCurrencySummary;
  pendingPaymentCurrencyTotals?: LogisticsExpenseCurrencySummary;
  paidCurrencyTotals?: LogisticsExpenseCurrencySummary;
  approvedAmountCny?: number;
  pendingPaymentAmountCny?: number;
  paidAmountCny?: number;
};

type ExpenseOrderOption = {
  id: string;
  orderId?: string;
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customerName?: string;
  customerShortName?: string;
  vesselVoyage?: string;
  truckPlateNo?: string;
  cargoName?: string;
  containerCount?: number;
  containerNos?: string[];
  containerType?: string;
  containerTypes?: string[];
  transportItems?: Array<{
    id?: string;
    containerNo?: string;
    containerType?: string;
    sealNo?: string;
    truckPlateNo?: string;
    departureDate?: string;
    departurePlace?: string;
    arrivalPlace?: string;
    cargoName?: string;
  }>;
  logisticsSuppliers?: SupplierOption[];
};

type SupplierOption = {
  id: string;
  supplierName?: string;
  name?: string;
  supplierType?: string;
  allowLogisticsExpenseEntry?: boolean;
  allowedLogisticsCostTypes?: string[];
};

type ExpenseForm = {
  orderId: string;
  supplierId: string;
  items: ExpenseItemForm[];
};

type ExpenseItemForm = {
  costType: string;
  billingMethod: string;
  amount: string;
  appliedContainerCount: string;
  currency: string;
  exchangeRate: string;
  remark: string;
};

type LogisticsExpenseDraft = {
  costType: string;
  billingMethod: string;
  unitAmount: string;
  appliedContainerCount: string;
  remark: string;
};

type LogisticsExpenseCurrencyTotal = {
  currency: string;
  amount: number;
};

type LogisticsExpenseCurrencySummary = {
  cnyActual: number;
  foreignTotals: LogisticsExpenseCurrencyTotal[];
  totalCny: number;
};

type LogisticsExpenseBatchUpdateItem = {
  id: string;
  costType?: string;
  amount: number;
  billingMethod: string;
  billingQuantity: number;
  appliedContainerCount: number;
  currency?: string;
  exchangeRate?: number;
  remark: string;
};

type LogisticsExpenseBatchCreateItem = {
  expenseType: string;
  amount: number;
  billingMethod: string;
  billingQuantity: number;
  appliedContainerCount: number;
  currency?: string;
  exchangeRate?: number;
  remark: string;
};

type LogisticsExpenseBatchSavePayload = {
  groupKey: string;
  orderId?: string;
  updates: LogisticsExpenseBatchUpdateItem[];
  creates: LogisticsExpenseBatchCreateItem[];
  deletes: string[];
};

type LogisticsExpenseBatchSaveResult = {
  items: LogisticsExpense[];
  bill?: LogisticsExpense;
  deletedIds: string[];
};

type LogisticsExpenseMutationResult = {
  success?: boolean;
  message?: string;
  expense?: LogisticsExpense;
  expenses?: LogisticsExpense[];
  bill?: LogisticsExpense;
  bills?: LogisticsExpense[];
  invoiceGroup?: string;
  emailError?: string;
  successCount?: number;
  failedCount?: number;
  results?: LogisticsExpenseReviewResult[];
};

type LogisticsExpenseReviewResult = {
  billId?: string;
  orderNo?: string;
  blNo?: string;
  auditStatus?: string;
  notificationStatus?: string;
  errorMessage?: string;
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

type LogisticsExpenseContainerSummary = {
  hasContainers: boolean;
  typeLines: string[];
  containerNoLines: string[];
  shortText: string;
};

const emptyExpenseItem = (): ExpenseItemForm => ({
  costType: "拖车费",
  billingMethod: "按柜",
  amount: "",
  appliedContainerCount: "1",
  currency: "CNY",
  exchangeRate: "1",
  remark: "",
});

const emptyExpenseForm: ExpenseForm = {
  orderId: "",
  supplierId: "",
  items: [emptyExpenseItem()],
};

export function LogisticsFeesModule({
  embedded = false,
  title = "物流费用录入",
  initialStatus = "",
  sectionId = "",
  focusBillId = "",
  focusKeyword = "",
  focusToken = 0,
  hideCreateAction = false,
  refreshToken = 0,
  currentUserRole = "",
  currentUserSupplierId = "",
  canCreateExpense: canCreateExpenseProp,
}: {
  embedded?: boolean;
  title?: string;
  initialStatus?: string;
  sectionId?: string;
  focusBillId?: string;
  focusKeyword?: string;
  focusToken?: number;
  hideCreateAction?: boolean;
  refreshToken?: number;
  currentUserRole?: string;
  currentUserSupplierId?: string;
  canCreateExpense?: boolean;
}) {
  const [rows, setRows] = useState<LogisticsExpense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [costType, setCostType] = useState("");
  const [statementMonth, setStatementMonth] = useState(new Date().toISOString().slice(0, 7));
  const [statementRows, setStatementRows] = useState<LogisticsStatementRow[]>([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [savingBillId, setSavingBillId] = useState("");
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canCreateExpense = !hideCreateAction && (canCreateExpenseProp ?? ["管理员", "物流供应商"].includes(currentUserRole));
  const canReviewExpense = currentUserRole === "管理员";
  const canConfirmInvoice = ["管理员", "财务"].includes(currentUserRole);
  const isLogisticsSupplier = currentUserRole === "物流供应商";
  const reviewableRows = rows.filter(logisticsExpenseBillCanApprove);
  const selectedReviewableRows = rows.filter((row) => logisticsExpenseSelectionSelected(row, selectedBillIds) && logisticsExpenseBillCanApprove(row));
  const allReviewableSelected = reviewableRows.length > 0 && reviewableRows.every((row) => logisticsExpenseSelectionSelected(row, selectedBillIds));

  async function loadExpenses(nextPage = page, nextKeyword = submittedKeyword, nextStatus = status, nextCostType = costType) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextStatus) params.set("status", nextStatus);
      if (nextCostType) params.set("costType", nextCostType);
      const result = await apiJson<LogisticsExpensesResponse>(`/api/logistics-costs?${params}`);
      const nextRows = sortLogisticsExpenseBillsForDisplay(Array.isArray(result.rows) ? result.rows : []);
      setRows(nextRows);
      setSelectedBillIds((current) => current.filter((id) => nextRows.some((row) => row.id === id && logisticsExpenseBillCanApprove(row))));
      setTotal(Number(result.total || 0));
      setPage(Number(result.page || nextPage));
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取物流费用失败");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExpenses(1, "", initialStatus, "");
    void loadStatement(statementMonth);
  }, []);

  useEffect(() => {
    if (!refreshToken) return;
    void loadExpenses(1, submittedKeyword, status, costType);
    void loadStatement(statementMonth);
  }, [refreshToken]);

  useEffect(() => {
    if (!focusToken) return;
    const nextKeyword = focusKeyword.trim();
    setKeyword(nextKeyword);
    setSubmittedKeyword(nextKeyword);
    setStatus("");
    setCostType("");
    setCreateOpen(false);
    setNotice("");
    void loadExpenses(1, nextKeyword, "", "").then((nextRows) => {
      const matched = nextRows.find((row) => row.id === focusBillId)
        || nextRows.find((row) => (
          row.orderNo === nextKeyword
          || row.blNo === nextKeyword
          || row.billOfLadingNo === nextKeyword
          || row.orderId === nextKeyword
        ))
        || nextRows[0];
      if (!matched) {
        setExpandedId("");
        setNotice("未找到对应物流费用账单，可在本区新增物流费用。");
        return;
      }
      setExpandedId(matched.id);
      setNotice("已打开对应物流费用账单。");
    });
  }, [focusToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setExpandedId("");
      setNotice("");
      void loadExpenses(1, value, status, costType);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, submittedKeyword, status, costType]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeExpense = expandedId ? rows.find((row) => row.id === expandedId) || null : null;

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setExpandedId("");
    setSelectedBillIds([]);
    setNotice("");
    void loadExpenses(1, value, status, costType);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setStatus(initialStatus);
    setCostType("");
    setExpandedId("");
    setSelectedBillIds([]);
    setNotice("");
    void loadExpenses(1, "", initialStatus, "");
  }

  function applyLogisticsExpenseMutationResult(result: LogisticsExpenseMutationResult) {
    setRows((currentRows) => reconcileLogisticsExpenseMutationRows(currentRows, result));
  }

  function toggleBillSelection(expense: LogisticsExpense, checked: boolean) {
    if (!logisticsExpenseBillCanApprove(expense)) return;
    const ids = logisticsExpenseShipmentBillIds(expense);
    setSelectedBillIds((current) => (
      checked
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id))
    ));
  }

  function toggleAllReviewableBills(checked: boolean) {
    setSelectedBillIds((current) => {
      const reviewableIds = reviewableRows.flatMap(logisticsExpenseShipmentBillIds);
      if (!checked) return current.filter((id) => !reviewableIds.includes(id));
      return [...new Set([...current, ...reviewableIds])];
    });
  }

  async function reviewExpenseBills(billIds: string[], sourceExpense: LogisticsExpense | null = null) {
    const ids = billIds.filter(Boolean);
    if (!ids.length) {
      setError("请选择需要审核的物流费用账单");
      setNotice("");
      return;
    }
    const busyKey = ids.length === 1 ? ids[0] : "__batch_review__";
    setBusyId(busyKey);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/review`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve", billIds: ids }),
      });
      const failureMessage = logisticsExpenseReviewFailureMessage(result);
      if (result.success !== true) throw new Error(failureMessage || result.message || "审核物流费用失败");
      await loadExpenses(page, submittedKeyword, status, costType);
      setSelectedBillIds((current) => current.filter((id) => !ids.includes(id)));
      if (sourceExpense && expandedId === sourceExpense.id) setExpandedId(sourceExpense.id);
      void loadStatement(statementMonth);
      setNotice(logisticsExpenseReviewNotice(result));
      if (failureMessage) setError(failureMessage);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "审核物流费用失败");
    } finally {
      setBusyId("");
    }
  }

  async function reviewSelectedBills() {
    if (!selectedReviewableRows.length) {
      setError("请选择待审核的物流费用账单");
      setNotice("");
      return;
    }
    const supplierCount = new Set(selectedReviewableRows.flatMap((row) => billSupplierIds(row))).size;
    const confirmationResult = await requestConfirmation({
      title: "合并审核 / 批量审核",
      message: "审核通过后系统会按供应商合并发送开票通知，同一供应商只发送一封邮件。",
      details: [
        `选中账单：${selectedReviewableRows.length} 票`,
        `涉及供应商：${supplierCount || 0} 家`,
      ],
      confirmLabel: "审核通过并通知",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    await reviewExpenseBills(selectedReviewableRows.flatMap(logisticsExpenseShipmentBillIds));
  }

  async function saveBillDetails(expense: LogisticsExpense, payload: LogisticsExpenseBatchSavePayload): Promise<LogisticsExpenseBatchSaveResult | null> {
    if (savingBillId === expense.id) return null;
    if (!payload.updates.length && !payload.creates.length && !payload.deletes.length) {
      setNotice("没有需要保存的修改");
      return null;
    }
    setBusyId(expense.id);
    setSavingBillId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; bill?: LogisticsExpense; items?: LogisticsExpense[]; details?: LogisticsExpense[]; rows?: LogisticsExpense[]; deletedIds?: string[]; message?: string }>("/api/logistics-expenses/batch-save", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (result.success !== true) throw new Error(result.message || "保存本账单明细失败");
      const savedRows = result.bill?.items?.length
        ? result.bill.items
        : (Array.isArray(result.items) ? result.items : (Array.isArray(result.details) ? result.details : (Array.isArray(result.rows) ? result.rows : [])));
      const deletedIds = Array.isArray(result.deletedIds) ? result.deletedIds : payload.deletes;
      let removedBill = false;
      setRows((currentRows) => {
        if (result.bill) return reconcileLogisticsExpenseMutationRows(currentRows, { bill: result.bill });
        const reconciliation = reconcileLogisticsExpenseRowsAfterBatchSave(currentRows, expense.id, savedRows, deletedIds);
        removedBill = reconciliation.removedBill;
        return reconciliation.rows;
      });
      if (removedBill) setTotal((current) => Math.max(0, current - 1));
      setNotice(result.message || "✓ 已保存");
      return { bill: result.bill, items: savedRows, deletedIds };
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存本账单明细失败");
      return null;
    } finally {
      setBusyId("");
      setSavingBillId("");
    }
  }

  async function deleteExpense(expense: LogisticsExpense) {
    const blockReason = logisticsExpenseDeleteBlockReason(expense);
    if (blockReason) {
      setError(blockReason);
      setNotice("");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "删除物流费用明细",
      message: "确定删除这条费用明细吗？删除后不可恢复。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `费用：${logisticsCostTypeLabel(expense.costType || "") || "-"} ${formatOriginalCurrencyAccounting(expense.currency || "CNY", expense.amount || 0)}`,
      ],
      confirmLabel: "确认删除",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setDeletingId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/logistics-expenses/${encodeURIComponent(expense.id)}`, {
        method: "DELETE",
      });
      if (result.success !== true) throw new Error(result.message || "删除物流费用明细失败");
      const removal = removeLogisticsExpenseFromRows(rows, expense.id);
      setRows(removal.rows);
      if (removal.removedBill) setTotal((current) => Math.max(0, current - 1));
      await loadStatement(statementMonth);
      setNotice("已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除物流费用明细失败");
    } finally {
      setBusyId("");
      setDeletingId("");
    }
  }

  async function withdrawExpense(expense: LogisticsExpense) {
    const items = logisticsExpenseBillItems(expense);
    const confirmationResult = await requestConfirmation({
      title: "确认撤回该物流费用账单？",
      message: "撤回后该账单下所有费用明细将同步回草稿，供应商可继续修改后重新提交。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `明细：${items.length} 项`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(items))}`,
      ],
      confirmLabel: "撤回账单",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "withdraw" }),
      });
      if (result.success !== true) throw new Error(result.message || "撤回物流费用账单失败");
      applyLogisticsExpenseMutationResult(result);
      await loadStatement(statementMonth);
      setNotice(result.message || "物流费用账单已撤回为草稿");
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : "撤回物流费用账单失败");
    } finally {
      setBusyId("");
    }
  }

  async function submitDraftExpenseBill(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const items = logisticsExpenseBillItems(expense);
    const billAuditStatus = logisticsExpenseBillAuditStatus(items);
    if (!logisticsExpenseBillIsEditable(billAuditStatus)) {
      setError("只有草稿或已驳回的物流费用账单可以提交审核");
      setNotice("");
      return;
    }
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult & { updatedIds?: string[]; submittedAt?: string }>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "submitBill" }),
        timeoutMs: 10000,
      });
      if (result.success !== true) throw new Error(result.message || "提交物流费用审核失败");
      if (result.bill || result.bills?.length || result.expenses?.length || result.expense) {
        applyLogisticsExpenseMutationResult(result);
      } else {
        const updatedIds = Array.isArray(result.updatedIds) && result.updatedIds.length
          ? result.updatedIds
          : items.map((item) => item.id);
        setRows((currentRows) => markLogisticsExpenseBillSubmitted(currentRows, expense.id, updatedIds, result.submittedAt));
      }
      setSelectedBillIds((current) => current.filter((id) => id !== expense.id));
      setNotice(result.message || "物流费用已提交审核");
    } catch (submitError) {
      const message = submitError instanceof ApiRequestError && submitError.status === 408
        ? "提交超时，请重试"
        : (submitError instanceof Error ? submitError.message : "提交物流费用审核失败");
      setError(`提交失败：${message}`);
    } finally {
      setBusyId("");
    }
  }

  async function rejectExpense(expense: LogisticsExpense) {
    const confirmationResult = await requestConfirmation({
      title: "驳回物流费用账单",
      message: "请填写驳回原因，供应商将看到该原因并补充修改。",
      requireInput: true,
      inputLabel: "驳回原因",
      inputPlaceholder: "请输入需要供应商修改的内容",
      inputRequiredMessage: "请填写驳回原因。",
      confirmLabel: "确认驳回",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    const rejectReason = confirmationResult.inputValue || "";
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; expenses?: LogisticsExpense[]; bill?: LogisticsExpense }>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", rejectReason }),
      });
      if (result.success !== true) throw new Error(result.message || "驳回物流费用账单失败");
      const savedItems = Array.isArray(result.expenses) && result.expenses.length
        ? result.expenses
        : (result.bill?.items || []);
      setRows((currentRows) => savedItems.length
        ? replaceLogisticsExpenseItemsInRows(currentRows, savedItems)
        : markLogisticsExpenseBillRejected(currentRows, expense.id, rejectReason));
      setSelectedBillIds((current) => current.filter((id) => id !== expense.id));
      setNotice(result.message || "物流费用账单已驳回");
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "驳回物流费用账单失败");
    } finally {
      setBusyId("");
    }
  }

  async function resendInvoiceNotice(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "resendInvoiceNotice" }),
      });
      if (result.success !== true) throw new Error(result.message || "重新发送开票通知失败");
      applyLogisticsExpenseMutationResult(result);
      setNotice(result.message || "开票通知已重新发送");
    } catch (noticeError) {
      setError(noticeError instanceof Error ? noticeError.message : "重新发送开票通知失败");
    } finally {
      setBusyId("");
    }
  }

  async function markExpenseBillPaid(expense: LogisticsExpense) {
    if (busyId === expense.id) return;
    const payState = logisticsExpensePayButtonState(expense);
    if (!payState.canMarkPaid) {
      setError(PAY_BUTTON_DISABLED_TOOLTIP);
      setNotice("");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "标记物流费用为已付款？",
      message: "确认后该账单付款状态将更新为已付款，并同步关联成本付款状态。",
      requireInput: true,
      inputType: "date",
      inputLabel: "付款时间",
      inputValue: expense.paymentDate || todayInputInChinaClient(),
      inputRequiredMessage: "请选择付款时间。",
      details: [
        `订单：${expense.orderNo || "-"}`,
        `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
        `账单合计：${logisticsCurrencySummaryPlainText(logisticsExpenseCurrencySummaryFromItems(logisticsExpenseBillItems(expense)))}`,
      ],
      confirmLabel: "标记已付款",
      cancelLabel: "取消",
      variant: "warning",
    });
    if (!confirmationResult.confirmed) return;
    setBusyId(expense.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<LogisticsExpenseMutationResult>(`/api/logistics-costs/${encodeURIComponent(expense.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "markPaid", paymentStatus: "已付款", paymentDate: confirmationResult.inputValue }),
      });
      if (result.success !== true) throw new Error(result.message || "标记已付款失败");
      applyLogisticsExpenseMutationResult(result);
      await loadStatement(statementMonth);
      setNotice(result.message || "物流费用已标记为已付款");
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "标记已付款失败");
    } finally {
      setBusyId("");
    }
  }

  async function loadStatement(month = statementMonth) {
    setStatementLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      const result = await apiJson<{ rows: LogisticsStatementRow[] }>(`/api/logistics-costs/statement${params.size ? `?${params}` : ""}`);
      setStatementRows(Array.isArray(result.rows) ? result.rows : []);
    } catch (statementError) {
      setError(statementError instanceof Error ? statementError.message : "读取月结汇总失败");
    } finally {
      setStatementLoading(false);
    }
  }

  function exportStatementCsv() {
    const header = ["月结月份", "供应商", "订单数", "应付金额", "待付款金额", "已付款金额"];
    const body = statementRows.map((row) => [
      statementMonth,
      row.supplierName || "-",
      String(row.orderCount || 0),
      logisticsCurrencySummaryPlainText(statementRowSummary(row, "approved")),
      logisticsCurrencySummaryPlainText(statementRowSummary(row, "pendingPayment")),
      logisticsCurrencySummaryPlainText(statementRowSummary(row, "paid")),
    ]);
    const csv = [header, ...body].map((line) => line.map(csvCell).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `物流费用月结_${statementMonth || "全部"}.csv`);
    setNotice("物流费用月结对账单已开始导出");
  }

  return (
    <section id={sectionId || undefined} className={`${embedded ? styles.subModuleCard : styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>{title}</h2>
        </div>
        <div className={styles.headerActions}>
          {canCreateExpense ? (
            <button
              className={styles.primaryButtonCompact}
              type="button"
              onClick={() => {
                setNotice("");
                setCreateOpen((open) => !open);
              }}
            >
              {createOpen ? "收起登记" : "新增物流费用"}
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadExpenses(page);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {createOpen ? (
        <LogisticsExpenseForm
          currentUserRole={currentUserRole}
          currentUserSupplierId={currentUserSupplierId}
          onCancel={() => setCreateOpen(false)}
          onSaved={(message) => {
            setCreateOpen(false);
            setExpandedId("");
            setNotice(message || "物流费用已保存");
            void loadExpenses(1, submittedKeyword, status, costType);
            void loadStatement(statementMonth);
          }}
        />
      ) : null}

      <div className={styles.statementPanel}>
        <div className={styles.statementHeader}>
          <div>
            <strong>月结汇总</strong>
            <span>按审核通过日期统计供应商应付、开票和付款状态。</span>
          </div>
          <div className={styles.statementActions}>
            <input
              value={statementMonth}
              onChange={(event) => setStatementMonth(event.target.value)}
              type="month"
            />
            <button className={styles.secondaryButton} type="button" disabled={statementLoading} onClick={() => loadStatement(statementMonth)}>
              {statementLoading ? "汇总中..." : "查询月结"}
            </button>
            <button className={styles.secondaryButton} type="button" disabled={!statementRows.length} onClick={exportStatementCsv}>
              导出对账单
            </button>
          </div>
        </div>
        <MonthlySummaryComponent rows={statementRows} />
        <SupplierSectionComponent rows={statementRows} loading={statementLoading} />
      </div>

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 供应商"
        />
        <select value={status} onChange={(event) => { setStatus(event.target.value); setNotice(""); void loadExpenses(1, submittedKeyword, event.target.value, costType); }}>
          {AUDIT_FILTERS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
        </select>
        <select value={costType} onChange={(event) => { setCostType(event.target.value); setNotice(""); void loadExpenses(1, submittedKeyword, status, event.target.value); }}>
          <option value="">全部费用类型</option>
          {COST_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
        {canReviewExpense ? (
          <button
            className={styles.billSaveButton}
            type="button"
            disabled={!selectedReviewableRows.length || busyId === "__batch_review__"}
            onClick={() => void reviewSelectedBills()}
          >
            {busyId === "__batch_review__" ? "审核中..." : `合并审核 / 批量审核${selectedReviewableRows.length ? `（${selectedReviewableRows.length}）` : ""}`}
          </button>
        ) : null}
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <LogisticsExpenseBillTable
        rows={rows}
        loading={loading}
        canReviewExpense={canReviewExpense}
        hasReviewableRows={Boolean(reviewableRows.length)}
        allReviewableSelected={allReviewableSelected}
        selectedBillIds={selectedBillIds}
        expandedId={expandedId}
        onToggleAllReviewableBills={toggleAllReviewableBills}
        onOpen={(expense) => setExpandedId(expense.id)}
        onSelectBill={toggleBillSelection}
      />

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={(nextPage) => {
        setExpandedId("");
        setNotice("");
        void loadExpenses(nextPage, submittedKeyword, status, costType);
      }} />
      {activeExpense ? (
        <LogisticsExpenseRows
          key={activeExpense.id}
          expense={activeExpense}
          busyId={busyId}
          deletingId={deletingId}
          saving={savingBillId === activeExpense.id}
          onClose={() => setExpandedId("")}
          canReview={canReviewExpense}
          canWithdraw={isLogisticsSupplier}
          canEditAmount={isLogisticsSupplier}
          canUploadInvoice={isLogisticsSupplier || canConfirmInvoice || canReviewExpense}
          canMarkPaid={canConfirmInvoice}
          canSubmitDraft={canCreateExpense}
          canDeleteExpense={canCreateExpense}
          canShowSupplier={currentUserRole === "管理员" || currentUserRole === "财务"}
          onApprove={(item) => void reviewExpenseBills(logisticsExpenseShipmentBillIds(item), item)}
          onReject={(item) => void rejectExpense(item)}
          onWithdraw={(item) => void withdrawExpense(item)}
          onResendInvoiceNotice={(item) => void resendInvoiceNotice(item)}
          onMarkPaid={(item) => void markExpenseBillPaid(item)}
          onSubmitDraft={(item) => void submitDraftExpenseBill(item)}
          onSaveDetails={(payload) => saveBillDetails(activeExpense, payload)}
          onValidationError={(message) => {
            setError(message);
            setNotice("");
          }}
          onInvoiceUploaded={(result) => {
            applyLogisticsExpenseMutationResult(result);
            setNotice(result.message || "物流发票已上传");
            void loadStatement(statementMonth);
          }}
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
}

function SupplierSectionComponent({
  rows,
  loading,
}: {
  rows: LogisticsStatementRow[];
  loading: boolean;
}) {
  if (!rows.length) {
    return <p className={styles.mutedText}>{loading ? "月结汇总加载中..." : "当前月份暂无已审核物流费用。"}</p>;
  }
  return (
    <div className={styles.statementList}>
      {rows.map((row) => (
        <div key={row.supplierId || row.supplierName || "-"} className={styles.statementRow}>
          <strong>{row.supplierName || "-"}</strong>
          <span>{row.orderCount || 0} 票</span>
          <span>供应商明细</span>
          <span>金额以上方月结汇总为准</span>
        </div>
      ))}
    </div>
  );
}

function LogisticsExpenseBillTable({
  rows,
  loading,
  canReviewExpense,
  hasReviewableRows,
  allReviewableSelected,
  selectedBillIds,
  expandedId,
  onToggleAllReviewableBills,
  onOpen,
  onSelectBill,
}: {
  rows: LogisticsExpense[];
  loading: boolean;
  canReviewExpense: boolean;
  hasReviewableRows: boolean;
  allReviewableSelected: boolean;
  selectedBillIds: string[];
  expandedId: string;
  onToggleAllReviewableBills: (checked: boolean) => void;
  onOpen: (expense: LogisticsExpense) => void;
  onSelectBill: (expense: LogisticsExpense, checked: boolean) => void;
}) {
  const colSpan = canReviewExpense ? 9 : 8;
  return (
    <div className={`${styles.tableWrap} ${styles.logisticsCompactTableWrap}`}>
      <table className={`${styles.dataTable} ${styles.logisticsCompactTable}`}>
        <thead>
          <tr>
            {canReviewExpense ? (
              <th className={styles.selectionColumn}>
                <UiCheckbox
                  variant="table"
                  label="选择本页待审核账单"
                  checked={allReviewableSelected}
                  disabled={!hasReviewableRows}
                  onChange={(event) => onToggleAllReviewableBills(event.target.checked)}
                />
              </th>
            ) : null}
            <th className={styles.orderNoColumn}>订单号 / Shipment</th>
            <th className={styles.customerColumn}>客户</th>
            <th className={styles.amountColumn}>CNY 合计</th>
            <th className={styles.amountColumn}>USD 合计</th>
            <th className={styles.statusColumn}>审核</th>
            <th className={styles.statusColumn}>发票</th>
            <th className={styles.statusColumn}>付款</th>
            <th className={styles.operationColumn}>操作</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colSpan}><div className={styles.emptyState}>数据加载中...</div></td></tr>
          ) : rows.length ? rows.map((expense) => (
            <LogisticsExpenseCompactRow
              key={expense.id}
              expense={expense}
              active={expandedId === expense.id}
              selectionEnabled={canReviewExpense}
              selected={logisticsExpenseSelectionSelected(expense, selectedBillIds)}
              onOpen={() => onOpen(expense)}
              onSelect={(checked) => onSelectBill(expense, checked)}
            />
          )) : (
            <tr><td colSpan={colSpan}><div className={styles.emptyState}>未找到匹配的物流费用</div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LogisticsExpenseCompactRow({
  expense,
  active,
  selectionEnabled,
  selected,
  onOpen,
  onSelect,
}: {
  expense: LogisticsExpense;
  active: boolean;
  selectionEnabled: boolean;
  selected: boolean;
  onOpen: () => void;
  onSelect: (checked: boolean) => void;
}) {
  const auditStatus = compactStatusLabel(logisticsExpenseBillAuditStatusFromRow(expense), "audit");
  const invoiceStatus = compactStatusLabel(logisticsExpenseBillInvoiceStatusFromRow(expense), "invoice");
  const paymentStatus = compactStatusLabel(logisticsExpenseBillPaymentStatusFromRow(expense), "payment");
  const items = expense.items?.length ? expense.items : [expense];
  const currencyTotals = expense.currencyTotals || logisticsExpenseCurrencySummaryFromItems(items);
  return (
    <tr className={`${styles.clickableRow} ${active ? styles.logisticsCompactRowActive : ""}`} onClick={onOpen}>
      {selectionEnabled ? (
        <td className={styles.selectionColumn} onClick={(event) => event.stopPropagation()}>
          <UiCheckbox
            variant="table"
            label={`选择账单 ${expense.orderNo || expense.blNo || expense.id}`}
            checked={selected}
            disabled={!logisticsExpenseBillCanApprove(expense)}
            onChange={(event) => onSelect(event.target.checked)}
          />
        </td>
      ) : null}
      <td className={styles.orderNoColumn}><strong>{expense.shipmentNo || expense.orderNo || "-"}</strong></td>
      <td className={styles.customerColumn} title={customerLegalName(expense)}>{expense.customer || customerDisplayName(expense)}</td>
      <td className={styles.amountColumn}>{formatOriginalCurrencyValue("CNY", logisticsCurrencyAmountByCode(currencyTotals, "CNY"))}</td>
      <td className={styles.amountColumn}>{formatOriginalCurrencyValue("USD", logisticsCurrencyAmountByCode(currencyTotals, "USD"))}</td>
      <td className={styles.statusColumn}><StatusPill value={auditStatus} /></td>
      <td className={styles.statusColumn}><StatusPill value={invoiceStatus} /></td>
      <td className={styles.statusColumn}><StatusPill value={paymentStatus} /></td>
      <td className={styles.operationColumn}>
        <button className={styles.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onOpen(); }}>
          详情
        </button>
      </td>
    </tr>
  );
}

function LogisticsExpenseRows({
  expense,
  busyId,
  deletingId,
  saving,
  onClose,
  onApprove,
  onReject,
  onWithdraw,
  onResendInvoiceNotice,
  onMarkPaid,
  onSubmitDraft,
  onSaveDetails,
  onValidationError,
  onInvoiceUploaded,
  canReview,
  canWithdraw,
  canEditAmount,
  canUploadInvoice,
  canMarkPaid,
  canSubmitDraft,
  canDeleteExpense,
  canShowSupplier,
}: {
  expense: LogisticsExpense;
  busyId: string;
  deletingId: string;
  saving: boolean;
  onClose: () => void;
  canReview: boolean;
  canWithdraw: boolean;
  canEditAmount: boolean;
  canUploadInvoice: boolean;
  canMarkPaid: boolean;
  canSubmitDraft: boolean;
  canDeleteExpense: boolean;
  canShowSupplier: boolean;
  onApprove: (expense: LogisticsExpense) => void;
  onReject: (expense: LogisticsExpense) => void;
  onWithdraw: (expense: LogisticsExpense) => void;
  onResendInvoiceNotice: (expense: LogisticsExpense) => void;
  onMarkPaid: (expense: LogisticsExpense) => void;
  onSubmitDraft: (expense: LogisticsExpense) => void;
  onSaveDetails: (payload: LogisticsExpenseBatchSavePayload) => Promise<LogisticsExpenseBatchSaveResult | null>;
  onValidationError: (message: string) => void;
  onInvoiceUploaded: (result: LogisticsExpenseMutationResult) => void;
}) {
  const items = expense.items?.length ? expense.items : [expense];
  const billAuditStatus = logisticsExpenseBillAuditStatus(items);
  const auditStatus = billAuditStatus;
  const invoiceStatus = logisticsExpenseBillInvoiceStatusFromRow(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  const canEditBillDetails = canEditAmount && logisticsExpenseBillIsEditable(billAuditStatus);
  const supplierNames = expense.supplierNames?.length ? expense.supplierNames : [...new Set(items.map((item) => item.supplierName).filter(Boolean))];
  const rejectReasons = [...new Set(items.map((item) => item.rejectReason || "").filter(Boolean))];
  const containerSummary = logisticsExpenseContainerSummary(expense, items);
  const canReviewBill = canReview && logisticsExpenseBillCanApprove(expense);
  const itemsSignature = items.map(logisticsExpenseDraftSignature).join("|");
  const defaultTab = defaultLogisticsExpenseDetailTab({
    auditStatus,
    invoiceStatus,
    paymentStatus,
  });
  const [drafts, setDrafts] = useState<Record<string, LogisticsExpenseDraft>>(() => logisticsExpenseDraftsFromItems(items));
  const [newExpenseRows, setNewExpenseRows] = useState<LogisticsExpense[]>([]);
  const [deletedExpenseIds, setDeletedExpenseIds] = useState<string[]>([]);
  const [billSaved, setBillSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(defaultTab);
  useEffect(() => {
    setDrafts(logisticsExpenseDraftsFromItems(items));
    setNewExpenseRows([]);
    setDeletedExpenseIds([]);
  }, [itemsSignature]);
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [expense.id, defaultTab]);
  const persistedEditingRows = items.filter((item) => !deletedExpenseIds.includes(item.id));
  const editingExpenseRows = [...persistedEditingRows, ...newExpenseRows];
  const changedItems = persistedEditingRows.filter((item) => logisticsExpenseDraftChanged(item, drafts[item.id]));
  const hasDirtyChanges = changedItems.length > 0;
  const hasPendingCreates = newExpenseRows.length > 0;
  const hasPendingDeletes = deletedExpenseIds.length > 0;
  const hasPendingChanges = hasDirtyChanges || hasPendingCreates || hasPendingDeletes;
  const billCurrencySummary = hasPendingChanges
    ? logisticsExpenseCurrencySummaryFromDrafts(editingExpenseRows, drafts)
    : logisticsExpenseCurrencySummaryFromItems(items);
  const canSubmitThisBill = canSubmitDraft && logisticsExpenseBillCanSubmit(expense);
  const shouldShowSubmitBill = canSubmitDraft && logisticsExpenseBillIsEditable(billAuditStatus);
  const invoiceGroups = expense.invoiceGroups?.length ? expense.invoiceGroups : logisticsInvoiceGroupsForBill(editingExpenseRows);
  const hasInvoiceNoticeFailure = invoiceGroups.some((group) => group.failed || group.status === "通知失败")
    || items.some((item) => logisticsExpenseDetailInvoiceStatus(item) === "通知失败" || Boolean(item.invoiceNotificationError));

  function updateDraft(id: string, field: keyof LogisticsExpenseDraft, value: string) {
    setBillSaved(false);
    setDrafts((current) => {
      const currentDraft = current[id] || logisticsExpenseDraftFromItem(items.find((item) => item.id === id) || ({ id } as LogisticsExpense));
      const nextDraft = {
        ...currentDraft,
        [field]: value,
      };
      return {
        ...current,
        [id]: nextDraft,
      };
    });
  }

  function addExpenseDetailRow() {
    if (!canEditBillDetails) {
      onValidationError(`账单${billAuditStatus}，不能新增费用明细`);
      return;
    }
    const temporaryRow = createTemporaryLogisticsExpenseRow(expense, items, newExpenseRows.length);
    setNewExpenseRows((current) => [...current, temporaryRow]);
    setDrafts((current) => ({
      ...current,
      [temporaryRow.id]: logisticsExpenseDraftFromItem(temporaryRow),
    }));
    setBillSaved(false);
  }

  function stageDeleteExpenseDetail(row: LogisticsExpense) {
    if (row.isTemporary) {
      setNewExpenseRows((current) => current.filter((item) => item.id !== row.id));
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setBillSaved(false);
      return;
    }
    if (!canEditBillDetails) {
      onValidationError(`账单${billAuditStatus}，不能删除费用明细`);
      return;
    }
    const blockReason = logisticsExpenseDeleteBlockReason(row);
    if (blockReason) {
      onValidationError(blockReason);
      return;
    }
    setDeletedExpenseIds((current) => current.includes(row.id) ? current : [...current, row.id]);
    setBillSaved(false);
  }

  async function handleSaveBillDetails() {
    if (!canEditBillDetails) {
      onValidationError(`账单${billAuditStatus}，不能修改费用明细`);
      return;
    }
    const invalidIndex = editingExpenseRows.findIndex((item) => {
      const draft = drafts[item.id];
      return (item.isTemporary || logisticsExpenseDraftChanged(item, draft)) && !validLogisticsExpenseDraft(draft, item.isTemporary);
    });
    if (invalidIndex >= 0) {
      const item = editingExpenseRows[invalidIndex];
      const validationMessage = logisticsExpenseDraftValidationMessage(item, drafts[item.id], invalidIndex);
      onValidationError(validationMessage);
      return;
    }
    const payload: LogisticsExpenseBatchSavePayload = {
      groupKey: expense.id,
      orderId: expense.orderId,
      updates: changedItems.map((item) => logisticsExpenseDraftPayload(item, drafts[item.id])),
      creates: newExpenseRows.map((item) => logisticsExpenseDraftCreatePayload(item, drafts[item.id])),
      deletes: deletedExpenseIds,
    };
    const saved = await onSaveDetails(payload);
    if (saved) {
      setNewExpenseRows([]);
      setDeletedExpenseIds([]);
      setBillSaved(true);
    }
  }

  function renderBillSaveControls() {
    if (!canEditBillDetails) return null;
    return (
      <>
        <span className={`${styles.saveStateBadge} ${hasPendingChanges ? styles.saveStateDirty : (billSaved ? styles.saveStateSaved : "")}`}>
          {hasPendingChanges ? "● 有未保存修改" : (billSaved ? "✓ 已保存" : "")}
        </span>
        <button
          className={styles.billAddLineButton}
          type="button"
          disabled={saving}
          onKeyDown={preventEnterFormSubmit}
          onClick={(event) => {
            event.stopPropagation();
            addExpenseDetailRow();
          }}
        >
          + 新增费用明细
        </button>
        <button
          className={styles.billSaveButton}
          type="button"
          disabled={!hasPendingChanges || saving}
          onKeyDown={preventEnterFormSubmit}
          onClick={(event) => {
            event.stopPropagation();
            void handleSaveBillDetails();
          }}
        >
          {saving ? "保存中..." : "保存本账单明细"}
        </button>
      </>
    );
  }

  function renderBillReviewControls() {
    if (!canReviewBill) return null;
    const busy = busyId === expense.id;
    return (
      <>
        <button
          className={styles.billApproveButton}
          type="button"
          disabled={busy || saving}
          title="审核当前提单账单并通知供应商开票"
          onClick={(event) => {
            event.stopPropagation();
            onApprove(expense);
          }}
        >
          {busy ? "处理中..." : "审核通过并通知开票"}
        </button>
        <button
          className={styles.billRejectButton}
          type="button"
          disabled={busy || saving}
          title="驳回当前提单账单并要求供应商修改"
          onClick={(event) => {
            event.stopPropagation();
            onReject(expense);
          }}
        >
          {busy ? "处理中..." : "驳回"}
        </button>
      </>
    );
  }

  function renderBillWithdrawControls() {
    if (!canWithdraw || billAuditStatus !== "待审核") return null;
    const busy = busyId === expense.id;
    return (
      <button
        className={styles.billAddLineButton}
        type="button"
        disabled={busy || saving}
        title="撤回当前账单，账单下所有费用明细同步回草稿"
        onClick={(event) => {
          event.stopPropagation();
          onWithdraw(expense);
        }}
      >
        {busy ? "撤回中..." : "撤回账单"}
      </button>
    );
  }

  function renderInvoiceNoticeControls() {
    if (!canReview || !hasInvoiceNoticeFailure) return null;
    const busy = busyId === expense.id;
    return (
      <button
        className={styles.billAddLineButton}
        type="button"
        disabled={busy || saving}
        title="仅重新发送当前账单开票通知，不重新审核"
        onClick={(event) => {
          event.stopPropagation();
          onResendInvoiceNotice(expense);
        }}
      >
        {busy ? "发送中..." : "重新发送开票通知"}
      </button>
    );
  }

  function renderBillPaymentControls() {
    if (!canMarkPaid) return null;
    const payState = logisticsExpensePayButtonState(expense);
    const busy = busyId === expense.id;
    const disabled = busy || saving || !payState.canMarkPaid;
    return (
      <button
        className={styles.billPayButton}
        type="button"
        disabled={disabled}
        title={payState.canMarkPaid ? "将当前账单标记为已付款" : PAY_BUTTON_DISABLED_TOOLTIP}
        onClick={(event) => {
          event.stopPropagation();
          if (!payState.canMarkPaid) return;
          onMarkPaid(expense);
        }}
      >
        {busy ? "更新中..." : (payState.alreadyPaid ? "已付款" : "标记已付款")}
      </button>
    );
  }

  function renderBillSubmitControls() {
    if (!shouldShowSubmitBill) return null;
    const disabled = !canSubmitThisBill || hasPendingChanges || busyId === expense.id || saving;
    const title = hasPendingChanges
      ? "请先保存本账单明细，再提交审核"
      : (canSubmitThisBill ? "将当前账单提交给管理员审核" : "只有草稿或已驳回的账单可以提交审核");
    return (
      <button
        className={styles.primaryButtonCompact}
        type="button"
        disabled={disabled}
        title={title}
        onClick={(event) => {
          event.stopPropagation();
          onSubmitDraft(expense);
        }}
      >
        {busyId === expense.id ? "提交中..." : "提交审核"}
      </button>
    );
  }

  const drawerSubtitle = [
    `提单号：${expense.blNo || expense.billOfLadingNo || "-"}`,
    `柜型：${containerSummary.shortText}`,
    `账单合计：${logisticsCurrencySummaryPlainText(billCurrencySummary)}`,
  ].join(" · ");

  return (
    <SideDetailDrawer
      ariaLabel="物流费用账单详情"
      kicker="物流费用账单"
      title={`${expense.orderNo || "-"} · ${customerDisplayName(expense)}`}
      subtitle={drawerSubtitle}
      onClose={onClose}
      surfaceClassName={styles.logisticsExpenseDrawer}
      actions={
        <>
          {renderBillSubmitControls()}
          {renderBillWithdrawControls()}
          {renderBillReviewControls()}
          {renderInvoiceNoticeControls()}
          {renderBillPaymentControls()}
          {renderBillSaveControls()}
        </>
      }
    >
      {hasInvoiceNoticeFailure ? (
        <div className={styles.logisticsBillInvoiceNoticeError}>
          <strong>开票通知发送失败</strong>
          <span>{invoiceGroups.map((group) => group.invoiceNotificationError || "").find(Boolean) || "请检查供应商绑定账号邮箱或供应商联系邮箱后重新发送。"}</span>
        </div>
      ) : null}
      {auditStatus.includes("驳回") && rejectReasons.length ? (
        <div className={styles.logisticsBillRejectNotice}>
          <strong>驳回原因</strong>
          <span>{rejectReasons.join("；")}</span>
        </div>
      ) : null}
      <UiTabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: "basic", label: "基础信息" },
          { key: "details", label: "费用明细" },
          { key: "invoice", label: "发票管理" },
          { key: "audit", label: "操作记录" },
        ]}
      />
      {activeTab === "basic" ? (
        <div className={styles.logisticsDrawerSection}>
          <div className={styles.detailGrid}>
            <DetailField label="客户全称" value={customerLegalName(expense)} wide />
            <DetailField label="订单号" value={expense.orderNo || "-"} />
            <DetailField label="提单号" value={expense.blNo || expense.billOfLadingNo || "-"} />
            <DetailField label="船名航次" value={expense.order?.vesselVoyage || expense.vesselVoyage || "-"} />
            <DetailField label="费用明细" value={`${editingExpenseRows.length} 项`} />
            <DetailField label="供应商" value={supplierNames.join(" / ") || "-"} hidden={!canShowSupplier || !supplierNames.length} wide />
            <div className={`${styles.detailField} ${styles.detailFieldWide}`}>
              <span>账单合计</span>
              <LogisticsCurrencyAmountList summary={billCurrencySummary} />
            </div>
          </div>
        </div>
      ) : null}
      {activeTab === "details" ? (
        <div className={styles.logisticsDrawerSection}>
          <div className={styles.logisticsDrawerSectionHeader}>
            <div>
              <strong>费用明细</strong>
              <span>{editingExpenseRows.length} 项</span>
              <LogisticsCurrencyAmountList summary={billCurrencySummary} compact />
            </div>
          </div>
          <LogisticsExpenseDetailsTable
            items={editingExpenseRows}
            drafts={drafts}
            busyId={busyId}
            deletingId={deletingId}
            billAuditStatus={billAuditStatus}
            canEditAmount={canEditBillDetails}
            canDeleteExpense={canDeleteExpense}
            onDraftChange={updateDraft}
            onStageDelete={stageDeleteExpenseDetail}
          />
        </div>
      ) : null}
      {activeTab === "invoice" ? (
        <div className={styles.logisticsDrawerSection}>
          <LogisticsInvoiceGroupsPanel
            expense={expense}
            items={editingExpenseRows}
            groups={invoiceGroups}
            canUploadInvoice={canUploadInvoice}
            onUploaded={onInvoiceUploaded}
          />
        </div>
      ) : null}
      {activeTab === "audit" ? (
        <div className={styles.detailGrid}>
          <DetailField label="审核状态" value={auditStatus} />
          <DetailField label="发票状态" value={invoiceStatus} />
          <DetailField label="付款状态" value={paymentStatus} />
          <DetailField label="付款时间" value={formatDate(expense.paymentDate)} />
          <DetailField label="提交时间" value={formatDateTime(expense.submittedAt)} />
          <DetailField label="审核人" value={expense.reviewedBy?.name || "-"} />
          <DetailField label="审核时间" value={formatDateTime(expense.reviewedAt)} />
          <DetailField label="创建人" value={items[0]?.createdBy?.name || "-"} />
          <DetailField label="创建时间" value={formatDateTime(items[0]?.createdAt)} />
          <DetailField label="更新人" value={items[0]?.updatedBy?.name || "-"} />
          <DetailField label="更新时间" value={formatDateTime(items[0]?.updatedAt)} />
          <DetailField label="驳回原因" value={rejectReasons.join("；") || "-"} wide hidden={!rejectReasons.length} />
        </div>
      ) : null}
    </SideDetailDrawer>
  );
}

function LogisticsExpenseDetailsTable({
  items,
  drafts,
  busyId,
  deletingId,
  billAuditStatus,
  canEditAmount,
  canDeleteExpense,
  onDraftChange,
  onStageDelete,
}: {
  items: LogisticsExpense[];
  drafts: Record<string, LogisticsExpenseDraft>;
  busyId: string;
  deletingId: string;
  billAuditStatus: string;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onDraftChange: (id: string, field: keyof LogisticsExpenseDraft, value: string) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
}) {
  return (
    <div className={styles.logisticsDetailTableWrap} onKeyDown={preventEnterFormSubmit}>
      <table className={styles.logisticsDetailTable}>
        <thead>
          <tr>
            <th>费用类型</th>
            <th>柜型</th>
            <th>数量</th>
            <th className={styles.numericCell}>金额</th>
            <th>备注</th>
            <th>发票状态</th>
            <th>成本同步</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((expense, index) => (
            <LogisticsExpenseDetailLine
              key={expense.id || `${expense.orderId || "expense"}-${index}`}
              expense={expense}
              draft={drafts[expense.id] || logisticsExpenseDraftFromItem(expense)}
              busy={busyId === expense.id}
              deleting={deletingId === expense.id}
              billAuditStatus={billAuditStatus}
              canEditAmount={canEditAmount}
              canDeleteExpense={canDeleteExpense}
              onDraftChange={onDraftChange}
              onStageDelete={onStageDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogisticsExpenseDetailLine({
  expense,
  draft,
  busy,
  deleting,
  billAuditStatus,
  canEditAmount,
  canDeleteExpense,
  onDraftChange,
  onStageDelete,
}: {
  expense: LogisticsExpense;
  draft: LogisticsExpenseDraft;
  busy: boolean;
  deleting: boolean;
  billAuditStatus: string;
  canEditAmount: boolean;
  canDeleteExpense: boolean;
  onDraftChange: (id: string, field: keyof LogisticsExpenseDraft, value: string) => void;
  onStageDelete: (expense: LogisticsExpense) => void;
}) {
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const billEditable = logisticsExpenseBillIsEditable(billAuditStatus);
  const editBlockReason = billEditable ? logisticsExpenseEditBlockReason(expense) : `账单${billAuditStatus}，不能修改`;
  const canEditThisAmount = canEditAmount && billEditable && !editBlockReason;
  const shouldRenderRemarkInput = canEditThisAmount;
  const originalAmount = logisticsExpenseOriginalAmount(expense);
  const originalCurrency = logisticsExpenseDisplayCurrency(expense, draft);
  const deleteBlockReason = billEditable ? logisticsExpenseDeleteBlockReason(expense) : `账单${billAuditStatus}，不能删除明细`;
  return (
    <tr>
      <td>
        {expense.isTemporary ? (
          <select
            className={styles.inlineCostTypeSelect}
            value={draft.costType}
            onChange={(event) => onDraftChange(expense.id, "costType", event.target.value)}
            aria-label="费用类型"
          >
            {COST_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        ) : (
          logisticsCostTypeLabel(expense.costType || "") || "-"
        )}
	      </td>
      <td>{logisticsExpenseLineContainerType(expense)}</td>
      <td>
        {canEditThisAmount ? (
          <input
            className={styles.inlineQuantityInput}
	            type="number"
	            min="1"
	            step="1"
	            value={draft.appliedContainerCount}
	            onChange={(event) => onDraftChange(expense.id, "appliedContainerCount", event.target.value)}
	            aria-label="适用数量"
	          />
	        ) : (
	          editableQuantityText(expenseBillingQuantity(expense))
	        )}
      </td>
      <td className={styles.numericCell}>
        <div className={styles.inlineAmountEditor}>
          {canEditThisAmount ? (
            <input
              value={draft.unitAmount}
              onChange={(event) => onDraftChange(expense.id, "unitAmount", event.target.value)}
              inputMode="decimal"
              aria-label="物流费用单价"
            />
          ) : (
            <strong>{formatOriginalCurrencyAccounting(originalCurrency, originalAmount)}</strong>
          )}
          {canEditThisAmount ? <span>{originalCurrency}</span> : null}
        </div>
      </td>
      <td className={styles.remarkCell} title={draft.remark || expense.remark || ""}>
        {shouldRenderRemarkInput ? (
          <div className={styles.inlineRemarkCell}>
            <input
              className={styles.inlineRemarkInput}
              value={draft.remark}
              onChange={(event) => onDraftChange(expense.id, "remark", event.target.value)}
              disabled={!canEditThisAmount}
              placeholder="-"
              aria-label="物流费用备注"
            />
            {!canEditThisAmount && editBlockReason ? (
              <span className={styles.inlineEditHint}>{editBlockReason}</span>
            ) : null}
          </div>
        ) : (
          expense.remark || "-"
        )}
      </td>
      <td><StatusPill value={compactStatusLabel(invoiceStatus, "invoice")} /></td>
      <td>
        <div className={styles.costSyncCell}>
          <span>{expenseCostSyncText(expense)}</span>
        </div>
      </td>
      <td>
        <div className={styles.compactDetailActions}>
          <button
            className={styles.logisticsLineDeleteButton}
            type="button"
            disabled={!canDeleteExpense || busy || deleting || (!expense.isTemporary && Boolean(deleteBlockReason))}
            title={!canDeleteExpense ? "无权限删除该费用明细" : (deleteBlockReason || "删除这条费用明细")}
            onClick={(event) => {
              event.stopPropagation();
              onStageDelete(expense);
            }}
          >
            {deleting ? "删除中..." : (expense.isTemporary ? "移除" : "删除")}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function LogisticsExpenseForm({
  onCancel,
  onSaved,
  initialOrder,
  currentUserRole = "",
  currentUserSupplierId = "",
}: {
  onCancel: () => void;
  onSaved: (message?: string) => void;
  initialOrder?: Partial<ExpenseOrderOption> | null;
  currentUserRole?: string;
  currentUserSupplierId?: string;
}) {
  const normalizedInitialOrder = initialOrder ? normalizeExpenseOrder(initialOrder) : null;
  const initialOrderId = normalizedInitialOrder?.id || "";
  const initialSuppliers = normalizedInitialOrder?.logisticsSuppliers || [];
  const isLockedSupplier = currentUserRole === "物流供应商" && Boolean(currentUserSupplierId);
  const [form, setForm] = useState<ExpenseForm>(() => ({
    ...emptyExpenseForm,
    orderId: initialOrderId,
    supplierId: isLockedSupplier ? currentUserSupplierId : (initialSuppliers.length === 1 ? initialSuppliers[0].id : ""),
    items: [emptyExpenseItem()],
  }));
  const [orders, setOrders] = useState<ExpenseOrderOption[]>(() => normalizedInitialOrder ? [normalizedInitialOrder] : []);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>(() => initialSuppliers);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (initialOrder) {
      const order = normalizeExpenseOrder(initialOrder);
      const orderSuppliers = order.logisticsSuppliers || [];
      setOrders([order]);
      setSuppliers(orderSuppliers);
      setForm((current) => ({
        ...current,
        orderId: order.id,
        supplierId: isLockedSupplier
          ? currentUserSupplierId
          : (orderSuppliers.length === 1 ? orderSuppliers[0].id : (orderSuppliers.some((supplier) => supplier.id === current.supplierId) ? current.supplierId : "")),
      }));
    }
  }, [initialOrder, isLockedSupplier, currentUserSupplierId]);

  useEffect(() => {
    if (!isLockedSupplier) return;
    setForm((current) => ({ ...current, supplierId: currentUserSupplierId }));
  }, [isLockedSupplier, currentUserSupplierId]);

  async function searchOrders(nextKeyword: string) {
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const result = await apiJson<{ rows: ExpenseOrderOption[] }>(`/api/logistics-costs/orders${params.size ? `?${params}` : ""}`);
      const rows = (Array.isArray(result.rows) ? result.rows : []).map((order) => normalizeExpenseOrder(order));
      setOrders((current) => mergeOrders(current, rows));
      return rows;
    } catch (orderError) {
      setMessage(orderError instanceof Error ? orderError.message : "读取可录入订单失败");
      return [];
    }
  }

  async function searchSuppliers(nextKeyword: string) {
    setMessage("");
    const selected = orders.find((order) => order.id === form.orderId);
    const orderSuppliers = filterLogisticsFeeSuppliers(selected?.logisticsSuppliers || []);
    if (!selected) {
      setMessage("请先选择关联订单");
      return [];
    }
    setSuppliers((current) => mergeSuppliers(current, orderSuppliers));
    const keyword = nextKeyword.trim().toLowerCase();
    if (!keyword) return orderSuppliers;
    return orderSuppliers.filter((supplier) => [
      supplier.supplierName,
      supplier.name,
      supplier.supplierType,
    ].some((value) => String(value || "").toLowerCase().includes(keyword)));
  }

  function setField<K extends keyof ExpenseForm>(key: K, value: ExpenseForm[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function resolveExpenseItemExchangeRate(index: number, currency: string) {
    const normalized = String(currency || "CNY").toUpperCase();
    if (normalized === "CNY") {
      setForm((current) => ({
        ...current,
        items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, currency: "CNY", exchangeRate: "1" } : item),
      }));
      return;
    }
    try {
      const result = await apiJson<ExchangeRateResponse>(`/api/exchange-rates?${new URLSearchParams({ currency: normalized })}`);
      const rate = Number(result.rate?.rateToCny ?? result.rate?.exchangeRate ?? result.rate?.rate ?? 0);
      if (rate > 0) {
        setForm((current) => ({
          ...current,
          items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, currency: normalized, exchangeRate: String(rate) } : item),
        }));
      } else {
        setMessage(`${normalized} 系统汇率未配置，请先刷新汇率。`);
      }
    } catch (rateError) {
      setMessage(rateError instanceof Error ? rateError.message : `${normalized} 汇率获取失败，请先刷新汇率。`);
    }
  }

  function setItemField<K extends keyof ExpenseItemForm>(index: number, key: K, value: ExpenseItemForm[K]) {
	    setForm((current) => ({
	      ...current,
	      items: current.items.map((item, itemIndex) => (
	        itemIndex === index
	          ? {
	              ...item,
	              [key]: value,
	              ...(key === "currency" && value === "CNY" ? { exchangeRate: "1" } : {}),
	            }
	          : item
	      )),
    }));
  }

  function handleItemCostTypeChange(index: number, costType: string) {
    const defaultCurrency = logisticsCostTypeDefaultCurrency(costType);
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index
          ? {
              ...item,
              costType,
              currency: defaultCurrency,
              exchangeRate: defaultCurrency === "CNY" ? "1" : "",
            }
          : item
      )),
    }));
    if (defaultCurrency !== "CNY") void resolveExpenseItemExchangeRate(index, defaultCurrency);
  }

  function handleItemCurrencyChange(index: number, currency: string) {
    setItemField(index, "currency", currency);
    void resolveExpenseItemExchangeRate(index, currency);
  }

  function addExpenseItem(copyLast = false) {
    setForm((current) => {
      const lastItem = current.items[current.items.length - 1];
      return {
        ...current,
        items: [
          ...current.items,
          copyLast && lastItem ? { ...lastItem, amount: "", remark: "" } : emptyExpenseItem(),
        ],
      };
    });
  }

  function removeExpenseItem(index: number) {
    setForm((current) => ({
      ...current,
      items: current.items.length > 1 ? current.items.filter((_, itemIndex) => itemIndex !== index) : current.items,
    }));
  }

  function handleOrderSelect(order: ExpenseOrderOption) {
    const normalizedOrder = normalizeExpenseOrder(order);
    const orderSuppliers = filterLogisticsFeeSuppliers(normalizedOrder.logisticsSuppliers || []);
    const nextSupplierId = isLockedSupplier
      ? currentUserSupplierId
      : orderSuppliers.length === 1
      ? orderSuppliers[0].id
      : "";
    const nextSupplier = orderSuppliers.find((supplier) => supplier.id === nextSupplierId) || null;
    const nextCostTypes = allowedCostTypeOptions(nextSupplier, isLockedSupplier);
    setOrders((current) => mergeOrders(current, [normalizedOrder]));
    setSuppliers((current) => mergeSuppliers(current, orderSuppliers));
    const availableSupplierIds = new Set(orderSuppliers.map((supplier) => supplier.id));
    setForm((current) => ({
      ...current,
      orderId: normalizedOrder.id,
      supplierId: nextSupplierId || (current.supplierId && availableSupplierIds.has(current.supplierId) ? current.supplierId : ""),
      items: current.items.map((item) => normalizeExpenseItemCostType(item, nextCostTypes)),
    }));
  }

  async function submitExpense(auditStatus: "草稿" | "待审核") {
    if (!form.orderId) {
      setMessage("请选择关联订单");
      return;
    }
	    const normalizedItems = form.items.map((item) => ({
	      costType: item.costType,
	      billingMethod: DEFAULT_BILLING_METHOD,
	      amount: lineSubtotal(item),
	      billingQuantity: Number(item.appliedContainerCount || 1),
	      appliedContainerCount: Number(item.appliedContainerCount || 1),
	      currency: item.currency,
      exchangeRate: Number(item.exchangeRate),
      remark: item.remark.trim(),
    }));
    const invalidIndex = normalizedItems.findIndex((item) => (
      !item.costType
      || !item.amount
      || item.amount <= 0
	      || !item.currency
	      || !item.exchangeRate
	      || item.exchangeRate <= 0
	      || !validBillingQuantity(item.appliedContainerCount)
	      || item.appliedContainerCount <= 0
	    ));
    if (invalidIndex >= 0) {
	      setMessage(`请完整填写第 ${invalidIndex + 1} 行费用类型、单价/金额、适用数量、币种和汇率`);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>("/api/logistics-costs", {
        method: "POST",
        body: JSON.stringify({
          orderId: form.orderId,
          supplierId: isLockedSupplier ? undefined : form.supplierId || undefined,
          items: normalizedItems,
          auditStatus,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "保存物流费用失败");
      setForm({ ...emptyExpenseForm, items: [emptyExpenseItem()] });
      onSaved(result.message || (auditStatus === "草稿" ? "物流费用草稿已保存" : "物流费用已提交审核"));
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "保存物流费用失败");
    } finally {
      setSaving(false);
    }
  }

  const selectedOrder = orders.find((order) => order.id === form.orderId);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === form.supplierId)
    || null;
  useEffect(() => {
    const nextCostTypes = allowedCostTypeOptions(selectedSupplier, isLockedSupplier);
    setForm((current) => {
      const items = current.items.map((item) => normalizeExpenseItemCostType(item, nextCostTypes));
      if (items.every((item, index) => item.costType === current.items[index]?.costType)) return current;
      return { ...current, items };
    });
  }, [selectedSupplier?.id, isLockedSupplier]);
  const supplierSummaryText = selectedSupplier
    ? supplierLabel(selectedSupplier)
    : (isLockedSupplier ? "加载供应商信息中..." : (selectedOrder ? "未选择" : "请先选择订单"));
  const supplierAllowedCostTypes = selectedSupplier?.allowedLogisticsCostTypes?.length
    ? selectedSupplier.allowedLogisticsCostTypes.map((type) => logisticsCostTypeLabel(type)).join(" / ")
    : "";
  const costTypeOptions = allowedCostTypeOptions(selectedSupplier, isLockedSupplier);
  const formCurrencySummary = logisticsExpenseFormCurrencySummary(form.items);

  return (
    <form
      className={styles.quickCreatePanel}
      onKeyDown={preventEnterFormSubmit}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>新增物流费用</strong>
        </div>
      </div>
      {message ? <div className={styles.inlineError}>{message}</div> : null}
      <div className={styles.reportFilterGrid}>
        <label>
          关联订单
          <SearchAutocomplete
            value={selectedOrder || null}
            cacheKey="logistics-fee-orders"
            emptyLabel="未找到可录入订单"
            placeholder="输入订单号 / 提单号 / 客户简称"
            getLabel={orderLabel}
            getDescription={(order) => {
              if (isLockedSupplier) {
                return customerLegalName(order);
              }
              const supplierCount = filterLogisticsFeeSuppliers(order.logisticsSuppliers || []).length;
              return `${customerLegalName(order)}${supplierCount ? ` · 已绑定 ${supplierCount} 家物流供应商` : ""}`;
            }}
            search={searchOrders}
            onSelect={handleOrderSelect}
          />
        </label>
        {!isLockedSupplier ? (
        <label>
          供应商
          <SearchAutocomplete
            value={selectedSupplier || null}
            cacheKey={`logistics-fee-suppliers:${form.orderId || "none"}`}
            emptyLabel={selectedOrder ? "该订单未分配物流相关供应商" : "请先选择订单"}
            placeholder={selectedOrder ? "选择该订单绑定物流相关供应商" : "请先选择订单"}
            disabled={isLockedSupplier || !selectedOrder}
            searchOnFocus
            getLabel={supplierLabel}
            getDescription={(supplier) => {
              const allowedTypes = supplier.allowedLogisticsCostTypes?.length
                ? ` · 允许：${supplier.allowedLogisticsCostTypes.join(" / ")}`
                : "";
              return `${supplier.supplierType || "物流费用供应商"}${allowedTypes}`;
            }}
            search={searchSuppliers}
            onSelect={(supplier) => {
              setSuppliers((current) => mergeSuppliers(current, [supplier]));
              const nextCostTypes = allowedCostTypeOptions(supplier, isLockedSupplier);
              setForm((current) => ({
                ...current,
                supplierId: supplier.id,
                items: current.items.map((item) => normalizeExpenseItemCostType(item, nextCostTypes)),
              }));
            }}
          />
        </label>
        ) : null}
      </div>
      {selectedOrder ? (
        <div className={styles.detailGrid}>
          <DetailField label="订单号" value={selectedOrder.orderNo || "-"} />
          <DetailField label="提单号" value={selectedOrder.blNo || selectedOrder.billOfLadingNo || "-"} />
          <DetailField label="客户简称" value={customerDisplayName(selectedOrder)} />
          <DetailField label="集装箱" value={containerSummaryText(selectedOrder)} />
          <DetailField label="车牌" value={selectedOrder.truckPlateNo || "-"} />
          <DetailField label="货物" value={selectedOrder.cargoName || "-"} wide />
        </div>
      ) : null}
      <div className={styles.logisticsItemsPanel}>
        <div className={styles.logisticsItemsHeader}>
          <div>
            <strong>费用明细</strong>
          </div>
        </div>
        <div className={styles.logisticsItemsTable}>
          <div className={styles.logisticsItemsHead}>
	            <span>费用类型</span>
	            <span>适用数量</span>
	            <span>单价/金额</span>
	            <span>币种</span>
            <span>汇率</span>
            <span>小计</span>
            <span>备注</span>
            <span>操作</span>
          </div>
          {form.items.map((item, index) => (
            <div className={styles.logisticsItemsRow} key={`${index}-${item.costType}`}>
	              <select value={item.costType} onChange={(event) => handleItemCostTypeChange(index, event.target.value)}>
	                {costTypeOptions.map((type) => <option key={type} value={type}>{logisticsCostTypeLabel(type)}</option>)}
	              </select>
	              <input
	                value={item.appliedContainerCount}
	                onChange={(event) => setItemField(index, "appliedContainerCount", event.target.value)}
	                type="number"
	                min="1"
	                step="1"
	                inputMode="decimal"
	                required
	              />
              <input value={item.amount} onChange={(event) => setItemField(index, "amount", event.target.value)} inputMode="decimal" required />
              <select
                value={item.currency}
                onChange={(event) => handleItemCurrencyChange(index, event.target.value)}
                disabled={logisticsCostTypeLocksCurrency(item.costType)}
                title={logisticsCostTypeLocksCurrency(item.costType) ? "海运费、ENS费、保险费默认锁定 USD" : undefined}
              >
                {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
              </select>
              <input value={item.exchangeRate} onChange={(event) => setItemField(index, "exchangeRate", event.target.value)} readOnly={item.currency === "CNY" || logisticsCostTypeLocksCurrency(item.costType)} inputMode="decimal" required />
              <strong>{formatOriginalCurrencyAccounting(item.currency, lineSubtotal(item))}</strong>
              <input value={item.remark} onChange={(event) => setItemField(index, "remark", event.target.value)} placeholder="可选" />
              <button className={styles.secondaryButton} type="button" disabled={form.items.length <= 1} onClick={() => removeExpenseItem(index)}>删除</button>
            </div>
          ))}
          <div className={styles.logisticsItemsInlineActions}>
            <button className={styles.secondaryButton} type="button" onKeyDown={preventEnterFormSubmit} onClick={() => addExpenseItem(false)}>添加费用</button>
            <button className={styles.secondaryButton} type="button" onKeyDown={preventEnterFormSubmit} onClick={() => addExpenseItem(true)}>复制上一行</button>
          </div>
        </div>
        <div className={styles.logisticsItemsTotal}>
          <LogisticsCurrencyAmountList summary={formCurrencySummary} />
        </div>
      </div>
      {!isLockedSupplier ? (
      <div className={styles.quickCreateMeta}>
        <span>供应商：{supplierSummaryText}</span>
        {supplierAllowedCostTypes ? <span>允许费用：{supplierAllowedCostTypes}</span> : null}
      </div>
      ) : null}
      <div className={styles.detailActions}>
        <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => void submitExpense("草稿")}>
          {saving ? "保存中..." : "保存草稿"}
        </button>
        <button className={styles.primaryButtonCompact} type="button" disabled={saving} onKeyDown={preventEnterFormSubmit} onClick={() => void submitExpense("待审核")}>
          {saving ? "提交中..." : "提交审核"}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
  );
}

function LogisticsInvoiceGroupsPanel({
  expense,
  items,
  groups,
  canUploadInvoice,
  onUploaded,
}: {
  expense: LogisticsExpense;
  items: LogisticsExpense[];
  groups: LogisticsInvoiceGroupSummary[];
  canUploadInvoice: boolean;
  onUploaded: (result: LogisticsExpenseMutationResult) => void;
}) {
  const [deletingGroupKey, setDeletingGroupKey] = useState("");
  const [groupMessage, setGroupMessage] = useState<Record<string, string>>({});
  const visibleGroups = groups.filter((group) => (group.itemIds?.length || 0) > 0 || !logisticsCurrencySummaryIsZero(group.currencyTotals));
  const approvedItems = items.filter((item) => logisticsExpenseBillAuditStatusFromRow(item) === "审核通过");
  if (!visibleGroups.length || !approvedItems.length) return null;

  async function deleteInvoiceGroup(targetExpense: LogisticsExpense, group: LogisticsInvoiceGroupSummary) {
    if (!group.invoiceDocumentId) return;
    if (!window.confirm("确定删除该发票文件？删除后需要重新上传。")) return;
    setDeletingGroupKey(group.key);
    setGroupMessage((current) => ({ ...current, [group.key]: "" }));
    try {
      const response = await fetch(`/api/logistics-costs/${encodeURIComponent(targetExpense.id)}/invoice`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceGroup: group.key, documentId: group.invoiceDocumentId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.message || "删除发票失败");
      setGroupMessage((current) => ({ ...current, [group.key]: "已删除发票" }));
      onUploaded(result);
    } catch (error) {
      setGroupMessage((current) => ({ ...current, [group.key]: error instanceof Error ? error.message : "删除发票失败" }));
    } finally {
      setDeletingGroupKey("");
    }
  }

  return (
    <div className={styles.logisticsInvoiceGroupsPanel}>
      <div className={styles.logisticsInvoiceGroupsHeader}>
        <div>
          <strong>发票上传</strong>
          <span>按费用类型分组上传，同一分组上传一次即可。</span>
        </div>
      </div>
      <div className={styles.logisticsInvoiceGroupsGrid}>
        {visibleGroups.map((group) => {
          const groupItems = items.filter((item) => logisticsInvoiceGroupForExpense(item)?.key === group.key);
          const groupCostTypes = [...new Set(groupItems.map((item) => item.costType).filter(Boolean))];
          const targetExpense = groupItems[0] || expense;
          const uploaded = Boolean(group.uploaded || group.status === "已上传" || group.status === "已确认");
          const confirmed = Boolean(group.confirmed || group.status === "已确认");
          const invoiceDocument = groupItems.map((item) => item.invoiceDocument).find((document) => document?.id) || null;
          const uploadedByName = invoiceDocument?.uploadedBy?.name
            || groupItems.map((item) => item.invoiceUploadedBy?.name || "").find(Boolean)
            || "-";
          const uploadedAt = invoiceDocument?.uploadedAt
            || groupItems.map((item) => item.invoiceUploadedAt || "").find(Boolean)
            || "";
          const canUploadGroup = canUploadInvoice
            && groupItems.length > 0
            && groupItems.every((item) => logisticsExpenseBillAuditStatusFromRow(item) === "审核通过")
            && !uploaded
            && !confirmed;
          const canDeleteGroup = canUploadInvoice && uploaded && !confirmed && Boolean(group.invoiceDocumentId);
          return (
            <div className={styles.logisticsInvoiceGroupCard} key={group.key}>
              <div className={styles.logisticsInvoiceGroupTitle}>
                <strong>{group.label}</strong>
                <StatusPill value={group.status || "待开票"} />
              </div>
              <div className={styles.logisticsInvoiceGroupMeta}>
                <span>包含费用：{(groupCostTypes.length ? groupCostTypes : (group.costTypes || [])).map((type) => logisticsCostTypeLabel(type)).join(" / ") || "-"}</span>
                <span>分组合计：<LogisticsCurrencyAmountList summary={group.currencyTotals || currencySummaryFromSingleExpense(targetExpense)} compact /></span>
                {group.invoiceNotificationError ? <span className={styles.logisticsInvoiceGroupError}>{group.invoiceNotificationError}</span> : null}
              </div>
              {uploaded ? (
                <div className={styles.logisticsInvoiceFileList}>
                  <strong>已上传文件列表</strong>
                  <div className={styles.logisticsInvoiceFileRow}>
                    <span className={styles.logisticsInvoiceFileName} title={invoiceDocument?.fileName || invoiceDocument?.originalFilename || "物流发票.pdf"}>
                      {invoiceDocument?.fileName || invoiceDocument?.originalFilename || "物流发票.pdf"}
                    </span>
                    <span>上传人：{uploadedByName}</span>
                    <span>上传时间：{uploadedAt ? formatDateTime(uploadedAt) : "-"}</span>
                    {group.invoiceDocumentId ? (
                      <PdfPreviewButton
                        documentId={group.invoiceDocumentId}
                        fileName={invoiceDocument?.fileName || invoiceDocument?.originalFilename || "物流发票.pdf"}
                      />
                    ) : null}
                    {canDeleteGroup ? (
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        disabled={deletingGroupKey === group.key}
                        onClick={() => deleteInvoiceGroup(targetExpense, group)}
                      >
                        {deletingGroupKey === group.key ? "删除中..." : "删除"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {canUploadGroup ? (
                <InvoiceUploadForm expense={targetExpense} group={group} onUploaded={onUploaded} />
              ) : null}
              {groupMessage[group.key] ? <span className={styles.inlineFormMessage}>{groupMessage[group.key]}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InvoiceUploadForm({
  expense,
  group,
  onUploaded,
}: {
  expense: LogisticsExpense;
  group: LogisticsInvoiceGroupSummary;
  onUploaded: (result: LogisticsExpenseMutationResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "failed">("idle");

  async function uploadInvoice(file: File) {
    const validationError = validatePdfUploadFile(file);
    if (validationError) {
      setStatus("failed");
      setProgress(0);
      setMessage(validationError);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    setProgress(0);
    setStatus("uploading");
    setMessage("上传中 0%");

    const body = new FormData();
    body.set("invoiceGroup", group.key);
    body.set("file", file);

    try {
      const result = await uploadFormDataWithProgress<LogisticsExpenseMutationResult>(
        `/api/logistics-costs/${encodeURIComponent(expense.id)}/invoice`,
        body,
        (nextProgress) => {
          setProgress(nextProgress);
          setMessage(`上传中 ${nextProgress}%`);
        },
      );
      setProgress(100);
      setStatus("success");
      setMessage("上传成功");
      onUploaded(result);
    } catch (uploadError) {
      setStatus("failed");
      setMessage(uploadError instanceof Error ? uploadError.message : "上传失败，请重试");
      setProgress(0);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] || null;
    if (!selectedFile || uploading) return;
    uploadInvoice(selectedFile);
  }

  return (
    <form className={styles.inlineInvoiceForm} onKeyDown={preventEnterFormSubmit} onSubmit={(event) => event.preventDefault()}>
      <input
        ref={inputRef}
        type="file"
        accept={PDF_UPLOAD_ACCEPT}
        aria-label={`${group.label}选择发票文件`}
        onChange={handleFileChange}
        disabled={uploading}
      />
      <span className={styles.invoiceUploadHelp}>仅支持 PDF，最大 {PDF_UPLOAD_MAX_SIZE_LABEL}。选择文件后自动上传。</span>
      {status !== "idle" ? (
        <span className={styles.invoiceUploadStatus} data-status={status}>
          <span className={styles.invoiceUploadProgressBar}>
            <span style={{ width: `${status === "success" ? 100 : progress}%` }} />
          </span>
          <span>{message || (status === "uploading" ? `上传中 ${progress}%` : status === "success" ? "上传成功" : "上传失败，请重试")}</span>
        </span>
      ) : null}
    </form>
  );
}

function StatusPill({ value }: { value: string }) {
  let tone = styles.statusMuted;
  if (["审核通过", "已确认", "已付款", "已上传", "已上传发票"].includes(value)) tone = styles.statusSuccess;
  if (["待审核", "未通知", "已通知开票", "待付款", "待开票", "草稿"].includes(value) || value.startsWith("部分")) tone = styles.statusWarning;
  if (["已驳回", "已退回", "已取消", "部分驳回", "通知失败", "待开票 / 通知失败"].includes(value)) tone = styles.statusDanger;
  return <span className={`${styles.statusPill} ${tone}`}>{value || "-"}</span>;
}

function normalizeExpenseOrder(order: Partial<ExpenseOrderOption>): ExpenseOrderOption {
  const id = order.orderId || order.id || "";
  const transportItems = Array.isArray(order.transportItems) ? order.transportItems : [];
  const containerNos = Array.isArray(order.containerNos)
    ? order.containerNos.filter(Boolean)
    : transportItems.map((item) => item.containerNo || "").filter(Boolean);
  const containerTypes = uniqueContainerTypes([
    order.containerType,
    ...(order.containerTypes || []),
    ...transportItems.map((item) => item.containerType),
  ]);
  return {
    ...order,
    id,
    orderId: id,
    transportItems,
    containerNos,
    containerTypes,
    containerType: order.containerType || (containerTypes.length === 1 ? containerTypes[0] : ""),
    containerCount: Number(order.containerCount || containerNos.length || transportItems.length || 0),
    logisticsSuppliers: filterLogisticsFeeSuppliers(order.logisticsSuppliers || []),
  };
}

function mergeOrders(current: ExpenseOrderOption[], next: ExpenseOrderOption[]) {
  const merged = [...current];
  for (const order of next.map((item) => normalizeExpenseOrder(item))) {
    if (order.id && !merged.some((item) => item.id === order.id)) merged.push(order);
  }
  return merged;
}

function mergeSuppliers(current: SupplierOption[], next: SupplierOption[]) {
  const merged = filterLogisticsFeeSuppliers(current);
  for (const supplier of filterLogisticsFeeSuppliers(next)) {
    if (supplier.id && !merged.some((item) => item.id === supplier.id)) merged.push(supplier);
  }
  return merged;
}

function orderLabel(order: ExpenseOrderOption) {
  const customer = customerDisplayName(order);
  const blNo = order.blNo || order.billOfLadingNo;
  return `${order.orderNo || "未编号"} / ${customer}${blNo ? ` / ${blNo}` : ""}`;
}

function supplierLabel(supplier: SupplierOption) {
  const name = supplier.supplierName || supplier.name || "未命名供应商";
  return supplier.supplierType ? `${name} / ${supplier.supplierType}` : name;
}

function filterLogisticsFeeSuppliers(suppliers: SupplierOption[]) {
  return suppliers.filter((supplier) => LOGISTICS_FEE_SUPPLIER_TYPES.includes(supplier.supplierType || ""));
}

function allowedCostTypeOptions(supplier: SupplierOption | null, shouldRestrict: boolean) {
  if (!shouldRestrict) return COST_TYPES;
  const allowed = supplier?.allowedLogisticsCostTypes?.filter((type) => COST_TYPES.includes(type)) || [];
  return allowed.length ? allowed : COST_TYPES;
}

function normalizeExpenseItemCostType(item: ExpenseItemForm, options: string[]) {
  if (!options.length || options.includes(item.costType)) return item;
  return { ...item, costType: options[0] || item.costType };
}

function lineSubtotal(item: ExpenseItemForm) {
  const unitPrice = Number(item.amount || 0);
  const quantity = Number(item.appliedContainerCount || 1);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return unitPrice * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1);
}

function logisticsExpenseFormCurrencySummary(items: ExpenseItemForm[]): LogisticsExpenseCurrencySummary {
  return finalizeLogisticsCurrencySummary(items.reduce((summary, item) => {
    const currency = normalizeCurrencyCode(item.currency);
    const amount = lineSubtotal(item);
    const exchangeRate = finiteNumber(item.exchangeRate, currency === "CNY" ? 1 : 0);
    addLogisticsCurrencyAmount(summary, currency, amount, amount * exchangeRate);
    return summary;
  }, createLogisticsCurrencyAccumulator()));
}

function validBillingQuantity(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  return Number.isInteger(numeric);
}

function billingQuantityLegacyInteger(value: unknown) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.max(1, Math.ceil(numeric));
}

function normalizeContainerType(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function uniqueContainerTypes(values: unknown[]) {
  return values
    .map(normalizeContainerType)
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function uniqueTextValues(values: unknown[]) {
  return values
    .map((value) => String(value || "").trim())
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function logisticsExpenseContainerSummary(expense: Partial<LogisticsExpense>, items: LogisticsExpense[] = []): LogisticsExpenseContainerSummary {
  const rows = [expense, ...(items.length ? items : [])];
  const seenTransportItems = new Set<string>();
  const transportItems: Array<{ containerNo: string; containerType: string }> = [];
  const fallbackNos: string[] = [];
  const fallbackTypes: unknown[] = [];
  let fallbackCount = 0;

  for (const row of rows) {
    const order = row.order || {};
    const orderTransportItems = Array.isArray(order.transportItems) ? order.transportItems : [];
    fallbackNos.push(...(order.containerNos || []));
    fallbackTypes.push(order.containerType, ...(order.containerTypes || []));
    fallbackCount = Math.max(fallbackCount, Number(order.containerCount || 0));
    for (const item of orderTransportItems) {
      const containerNo = String(item.containerNo || "").trim();
      const containerType = normalizeContainerType(item.containerType);
      const key = item.id || `${containerNo}|${containerType}|${String(item.sealNo || "").trim()}`;
      if ((!containerNo && !containerType) || seenTransportItems.has(key)) continue;
      seenTransportItems.add(key);
      transportItems.push({ containerNo, containerType });
    }
  }

  const typeCounts = new Map<string, number>();
  if (transportItems.length) {
    for (const item of transportItems) {
      if (!item.containerType) continue;
      typeCounts.set(item.containerType, (typeCounts.get(item.containerType) || 0) + 1);
    }
  } else {
    const types = uniqueContainerTypes(fallbackTypes);
    const nos = uniqueTextValues(fallbackNos);
    if (types.length === 1) {
      typeCounts.set(types[0], nos.length || fallbackCount || 1);
    } else {
      for (const type of types) typeCounts.set(type, 0);
    }
  }

  const typeLines = [...typeCounts.entries()].map(([type, count]) => (count > 0 ? `${type} × ${count}` : type));
  const containerNoLines = transportItems.length
    ? uniqueTextValues(transportItems.map((item) => item.containerNo))
    : uniqueTextValues(fallbackNos);
  const hasContainers = Boolean(typeLines.length || containerNoLines.length);
  return {
    hasContainers,
    typeLines,
    containerNoLines,
    shortText: hasContainers && typeLines.length ? typeLines.map((line) => line.replace(/\s×\s/g, "×")).join(" / ") : "未录入",
  };
}

function containerSummaryText(order?: ExpenseOrderOption | null) {
  const count = Number(order?.containerCount || 0);
  if (!count) return "未录入集装箱明细";
  const nos = order?.containerNos?.length ? `：${order.containerNos.join(" / ")}` : "";
  return `${count} 个柜${nos}`;
}

function formatCnyAccounting(value: unknown) {
  return `¥ ${formatAmount(value)}`;
}

const LOGISTICS_CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  HKD: "HK$",
};

function formatOriginalCurrencyAccounting(currency: string, value: unknown) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "CNY") return formatCnyAccounting(value);
  const symbol = LOGISTICS_CURRENCY_SYMBOLS[normalized] || normalized;
  return `${normalized} ${symbol}${formatAmount(value)}`;
}

function formatOriginalCurrencyValue(currency: string, value: unknown) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "CNY") return formatCnyAccounting(value);
  const symbol = LOGISTICS_CURRENCY_SYMBOLS[normalized] || normalized;
  return `${symbol}${formatAmount(value)}`;
}

const MONTHLY_SUMMARY_STATUS_ROWS: Array<{
  key: "approved" | "pendingPayment" | "paid";
  label: string;
}> = [
  { key: "approved", label: "应付总额" },
  { key: "pendingPayment", label: "待付款" },
  { key: "paid", label: "已付款" },
];

function MonthlySummaryComponent({ rows }: { rows: LogisticsStatementRow[] }) {
  const monthlySummary = buildMonthlySummary(rows);
  return (
    <div className={styles.monthlySummaryCard}>
      <table className={styles.monthlySummaryTable}>
        <thead>
          <tr>
            <th>状态</th>
            {monthlySummary.currencies.map((currency) => (
              <th key={currency}>{currency} 合计</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthlySummary.statusRows.map((row) => (
            <tr key={row.key}>
              <td>{row.label}</td>
              {monthlySummary.currencies.map((currency) => (
                <td key={`${row.key}-${currency}`}>{formatOriginalCurrencyValue(currency, row.amounts[currency] || 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildMonthlySummary(rows: LogisticsStatementRow[]) {
  const totals = rows.reduce((acc, row) => {
    acc.approved = mergeLogisticsCurrencySummaries(acc.approved, statementRowSummary(row, "approved"));
    acc.pendingPayment = mergeLogisticsCurrencySummaries(acc.pendingPayment, statementRowSummary(row, "pendingPayment"));
    acc.paid = mergeLogisticsCurrencySummaries(acc.paid, statementRowSummary(row, "paid"));
    return acc;
  }, {
    approved: emptyLogisticsCurrencySummary(),
    pendingPayment: emptyLogisticsCurrencySummary(),
    paid: emptyLogisticsCurrencySummary(),
  });
  const currencies = monthlySummaryCurrencies(Object.values(totals));
  const statusRows = MONTHLY_SUMMARY_STATUS_ROWS.map((item) => ({
    ...item,
    amounts: monthlySummaryAmountsByCurrency(totals[item.key], currencies),
  }));
  return { currencies, statusRows };
}

function monthlySummaryCurrencies(summaries: LogisticsExpenseCurrencySummary[]) {
  const currencies = new Set<string>();
  for (const summary of summaries) {
    if (Math.abs(Number(summary.cnyActual || 0)) > 0.000001) currencies.add("CNY");
    for (const item of summary.foreignTotals || []) currencies.add(item.currency);
  }
  if (!currencies.size) currencies.add("CNY");
  return [...currencies].sort((left, right) => logisticsCurrencyOrder(left) - logisticsCurrencyOrder(right) || left.localeCompare(right));
}

function monthlySummaryAmountsByCurrency(summary: LogisticsExpenseCurrencySummary, currencies: string[]) {
  const amounts: Record<string, number> = {};
  for (const currency of currencies) {
    amounts[currency] = currency === "CNY"
      ? Number(summary.cnyActual || 0)
      : Number((summary.foreignTotals || []).find((item) => item.currency === currency)?.amount || 0);
  }
  return amounts;
}

function logisticsCurrencyAmountByCode(summary: LogisticsExpenseCurrencySummary, currency: string) {
  const normalized = normalizeCurrencyCode(currency);
  if (normalized === "CNY") return Number(summary.cnyActual || 0);
  return Number((summary.foreignTotals || []).find((item) => item.currency === normalized)?.amount || 0);
}

function LogisticsCurrencyAmountList({
  summary,
  compact = false,
}: {
  summary: LogisticsExpenseCurrencySummary;
  compact?: boolean;
}) {
  return (
    <div className={`${styles.logisticsCurrencySummary} ${compact ? styles.logisticsCurrencySummaryCompact : ""}`}>
      {Math.abs(summary.cnyActual) > 0.000001 || !summary.foreignTotals.length ? (
        <div className={styles.logisticsCurrencySummaryRow}>
          <span>CNY：</span>
          <strong>{formatOriginalCurrencyValue("CNY", summary.cnyActual)}</strong>
        </div>
      ) : null}
      {summary.foreignTotals.map((item) => (
        <div className={styles.logisticsCurrencySummaryRow} key={item.currency}>
          <span>{item.currency}：</span>
          <strong>{formatOriginalCurrencyValue(item.currency, item.amount)}</strong>
        </div>
      ))}
    </div>
  );
}

function currencySummaryFromSingleExpense(expense: LogisticsExpense): LogisticsExpenseCurrencySummary {
  const currency = normalizeCurrencyCode(expense.currency);
  const amount = logisticsExpenseOriginalAmount(expense);
  const amountCny = logisticsExpenseAmountCny(expense, amount, currency);
  const accumulator = createLogisticsCurrencyAccumulator();
  addLogisticsCurrencyAmount(accumulator, currency, amount, amountCny);
  return finalizeLogisticsCurrencySummary(accumulator);
}

function logisticsExpenseCurrencySummaryFromItems(items: LogisticsExpense[]): LogisticsExpenseCurrencySummary {
  return finalizeLogisticsCurrencySummary(items.reduce((summary, item) => {
    const currency = normalizeCurrencyCode(item.currency);
    const originalAmount = logisticsExpenseOriginalAmount(item);
    const amountCny = logisticsExpenseAmountCny(item, originalAmount, currency);
    addLogisticsCurrencyAmount(summary, currency, originalAmount, amountCny);
    return summary;
  }, createLogisticsCurrencyAccumulator()));
}

function logisticsExpenseCurrencySummaryFromDrafts(
  items: LogisticsExpense[],
  drafts: Record<string, LogisticsExpenseDraft>,
): LogisticsExpenseCurrencySummary {
  return finalizeLogisticsCurrencySummary(items.reduce((summary, item) => {
    const draft = drafts[item.id];
    const currency = logisticsExpenseDisplayCurrency(item, draft);
    const originalAmount = logisticsExpenseDraftOriginalAmount(item, draft);
    const amountCny = originalAmount * finiteNumber(item.exchangeRate, currency === "CNY" ? 1 : 0);
    addLogisticsCurrencyAmount(summary, currency, originalAmount, amountCny);
    return summary;
  }, createLogisticsCurrencyAccumulator()));
}

function emptyLogisticsCurrencySummary(): LogisticsExpenseCurrencySummary {
  return { cnyActual: 0, foreignTotals: [], totalCny: 0 };
}

function logisticsCurrencySummaryIsZero(summary?: LogisticsExpenseCurrencySummary | null) {
  if (!summary) return true;
  return Math.abs(Number(summary.cnyActual || 0)) < 0.000001
    && !(summary.foreignTotals || []).some((item) => Math.abs(Number(item.amount || 0)) >= 0.000001);
}

function mergeLogisticsCurrencySummaries(
  left: LogisticsExpenseCurrencySummary = emptyLogisticsCurrencySummary(),
  right: LogisticsExpenseCurrencySummary = emptyLogisticsCurrencySummary(),
): LogisticsExpenseCurrencySummary {
  const accumulator = createLogisticsCurrencyAccumulator();
  addLogisticsCurrencyAmount(accumulator, "CNY", left.cnyActual, left.cnyActual);
  for (const item of left.foreignTotals || []) addLogisticsCurrencyAmount(accumulator, item.currency, item.amount, 0);
  addLogisticsCurrencyAmount(accumulator, "CNY", right.cnyActual, right.cnyActual);
  for (const item of right.foreignTotals || []) addLogisticsCurrencyAmount(accumulator, item.currency, item.amount, 0);
  return finalizeLogisticsCurrencySummary(accumulator);
}

function logisticsCurrencySummaryPlainText(summary?: LogisticsExpenseCurrencySummary | null) {
  const safeSummary = summary || emptyLogisticsCurrencySummary();
  const lines: string[] = [];
  if (Math.abs(Number(safeSummary.cnyActual || 0)) > 0.000001 || !(safeSummary.foreignTotals || []).length) {
    lines.push(`CNY：${formatOriginalCurrencyAccounting("CNY", safeSummary.cnyActual)}`);
  }
  for (const item of safeSummary.foreignTotals || []) {
    lines.push(`${item.currency}：${formatOriginalCurrencyAccounting(item.currency, item.amount)}`);
  }
  return lines.join(" / ");
}

function statementRowSummary(
  row: LogisticsStatementRow,
  key: "approved" | "pendingPayment" | "paid",
): LogisticsExpenseCurrencySummary {
  const summary = key === "approved"
    ? row.approvedCurrencyTotals
    : key === "pendingPayment"
      ? row.pendingPaymentCurrencyTotals
      : row.paidCurrencyTotals;
  if (summary) return summary;
  const fallback = key === "approved"
    ? row.approvedAmountCny
    : key === "pendingPayment"
      ? row.pendingPaymentAmountCny
      : row.paidAmountCny;
  return { cnyActual: Number(fallback || 0), foreignTotals: [], totalCny: Number(fallback || 0) };
}

function createLogisticsCurrencyAccumulator() {
  return {
    cnyActual: 0,
    foreignTotals: new Map<string, number>(),
    totalCny: 0,
  };
}

function addLogisticsCurrencyAmount(
  summary: ReturnType<typeof createLogisticsCurrencyAccumulator>,
  currency: string,
  originalAmount: number,
  amountCny: number,
) {
  if (currency === "CNY") {
    summary.cnyActual += originalAmount;
  } else {
    summary.foreignTotals.set(currency, (summary.foreignTotals.get(currency) || 0) + originalAmount);
  }
  summary.totalCny += amountCny;
}

function finalizeLogisticsCurrencySummary(
  summary: ReturnType<typeof createLogisticsCurrencyAccumulator>,
): LogisticsExpenseCurrencySummary {
  return {
    cnyActual: roundCurrencyTotal(summary.cnyActual),
    foreignTotals: [...summary.foreignTotals.entries()]
      .map(([currency, amount]) => ({ currency, amount: roundCurrencyTotal(amount) }))
      .filter((item) => Math.abs(item.amount) > 0.000001)
      .sort((left, right) => logisticsCurrencyOrder(left.currency) - logisticsCurrencyOrder(right.currency)
        || left.currency.localeCompare(right.currency)),
    totalCny: roundCurrencyTotal(summary.totalCny),
  };
}

function logisticsCurrencyOrder(currency: string) {
  const index = FOREIGN_CURRENCY_ORDER.indexOf(currency);
  return index >= 0 ? index : FOREIGN_CURRENCY_ORDER.length;
}

function logisticsExpenseOriginalAmount(expense: LogisticsExpense) {
  const amount = finiteNumberOrNull(expense.amount);
  if (amount !== null) return amount;
  const amountCny = finiteNumber(expense.amountCny, 0);
  const currency = normalizeCurrencyCode(expense.currency);
  const exchangeRate = finiteNumber(expense.exchangeRate, currency === "CNY" ? 1 : 0);
  if (currency === "CNY" || exchangeRate <= 0) return amountCny;
  return amountCny / exchangeRate;
}

function logisticsExpenseDisplayCurrency(expense: LogisticsExpense, draft?: LogisticsExpenseDraft) {
  const costType = draft?.costType || expense.costType || "";
  if (logisticsCostTypeDefaultCurrency(costType) === "USD") return "USD";
  return normalizeCurrencyCode(expense.currency);
}

function logisticsExpenseAmountCny(expense: LogisticsExpense, originalAmount: number, currency: string) {
  const amountCny = finiteNumberOrNull(expense.amountCny);
  if (amountCny !== null) return amountCny;
  return originalAmount * finiteNumber(expense.exchangeRate, currency === "CNY" ? 1 : 0);
}

function logisticsExpenseDraftOriginalAmount(expense: LogisticsExpense, draft?: LogisticsExpenseDraft) {
  if (!draft || (!validLogisticsExpenseDraft(draft, expense.isTemporary) && !draft.unitAmount.trim())) {
    return logisticsExpenseOriginalAmount(expense);
  }
  return editableLineSubtotal(draft.unitAmount, draft.appliedContainerCount);
}

function normalizeCurrencyCode(value: unknown) {
  const currency = String(value || "CNY").trim().toUpperCase();
  return currency || "CNY";
}

function finiteNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function finiteNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundCurrencyTotal(value: number) {
  return Math.round(value * 100) / 100;
}

function compactStatusLabel(value: unknown, type: "audit" | "invoice" | "payment") {
  const text = String(value || "").trim();
  if (!text || text === "-") {
    if (type === "audit") return "草稿";
    if (type === "invoice") return "待开票";
    return "待付款";
  }
  if (type === "audit") {
    if (text.includes("待审核")) return "待审核";
    if (text.includes("审核通过")) return "审核通过";
    if (text.includes("驳回")) return "已驳回";
    return "草稿";
  }
  if (type === "invoice") {
    if (text.includes("通知失败")) return "通知失败";
    if (text.includes("部分")) return "部分上传";
    if (text.includes("已确认") || text.includes("已上传")) return "已上传";
    return "待开票";
  }
  if (text.includes("已付款")) return "已付款";
  if (text.includes("部分")) return "部分付款";
  return "待付款";
}

function logisticsExpensePayButtonState(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  const auditStatus = compactStatusLabel(logisticsExpenseBillAuditStatusFromRow(expense), "audit");
  const invoiceStatus = normalizePayButtonInvoiceStatus([
    logisticsExpenseBillInvoiceStatusFromRow(expense),
    expense.billInvoiceStatus,
    expense.invoiceStatus,
    ...items.flatMap((item) => [item.billInvoiceStatus, item.invoiceStatus, item.detailInvoiceStatus]),
  ]);
  const paymentStatus = compactStatusLabel(logisticsExpenseBillPaymentStatusFromRow(expense), "payment");
  return { ...logisticsBillPayState({ auditStatus, invoiceStatus, paymentStatus }), rule: PAY_BUTTON_RULE };
}

function normalizePayButtonInvoiceStatus(values: unknown[]) {
  const statuses = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (statuses.some((status) => status.includes("已上传发票") || status === "已上传" || status.includes("已确认"))) {
    return "已上传发票";
  }
  if (statuses.some((status) => status.includes("部分"))) return "未上传发票";
  return "未上传发票";
}

function logisticsExpenseLineContainerType(expense: LogisticsExpense) {
  const types = uniqueContainerTypes([
    expense.containerType,
    expense.order?.containerType,
    ...(expense.order?.containerTypes || []),
    ...(expense.order?.transportItems || []).map((item) => item.containerType),
  ]);
  if (!types.length) return "-";
  return types.length === 1 ? types[0] : types.join(" / ");
}

function expenseUnitAmount(expense: LogisticsExpense) {
  const count = Number(expenseBillingQuantity(expense));
  const divisor = Number.isFinite(count) && count > 0 ? count : 1;
  return Number(expense.amount || 0) / divisor;
}

function expenseBillingQuantity(expense: Partial<LogisticsExpense>) {
  const quantity = Number(expense.billingQuantity ?? expense.appliedContainerCount ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function logisticsExpenseDraftFromItem(expense: Partial<LogisticsExpense>): LogisticsExpenseDraft {
  return {
    costType: expense.costType || "拖车费",
    billingMethod: DEFAULT_BILLING_METHOD,
    unitAmount: editableNumberText(expenseUnitAmount(expense as LogisticsExpense)),
    appliedContainerCount: editableQuantityText(expenseBillingQuantity(expense)),
    remark: expense.remark || "",
  };
}

function logisticsExpenseDraftsFromItems(items: LogisticsExpense[]) {
  return items.reduce<Record<string, LogisticsExpenseDraft>>((acc, item) => {
    if (item.id) acc[item.id] = logisticsExpenseDraftFromItem(item);
    return acc;
  }, {});
}

function logisticsExpenseDraftSignature(expense: LogisticsExpense) {
  return [
	    expense.id,
	    expense.costType || "",
	    expense.amount || 0,
	    expense.amountCny || 0,
	    expense.containerType || "",
	    expense.appliedContainerCount || 1,
	    expense.billingMethod || "",
	    expense.billingQuantity || "",
	    expense.exchangeRate || 1,
	    expense.remark || "",
	  ].join(":");
}

function logisticsExpenseDraftChanged(expense: LogisticsExpense, draft?: LogisticsExpenseDraft) {
  if (!draft) return false;
	  const initial = logisticsExpenseDraftFromItem(expense);
	  return draft.costType !== initial.costType
	    || draft.unitAmount.trim() !== initial.unitAmount
	    || draft.appliedContainerCount !== initial.appliedContainerCount
	    || draft.remark !== initial.remark;
}

function validLogisticsExpenseDraft(draft?: LogisticsExpenseDraft, isCreate = false) {
	  if (!draft) return false;
	  if (!draft.costType || !COST_TYPES.includes(draft.costType)) return false;
	  if (!draft.unitAmount.trim()) return false;
	  const unitAmount = Number(draft.unitAmount);
	  return Number.isFinite(unitAmount) && (isCreate ? unitAmount > 0 : unitAmount >= 0) && validBillingQuantity(draft.appliedContainerCount);
}

function logisticsExpenseDraftPayload(expense: LogisticsExpense, draft?: LogisticsExpenseDraft): LogisticsExpenseBatchUpdateItem {
  const safeDraft = draft || logisticsExpenseDraftFromItem(expense);
  const currency = logisticsCostTypeDefaultCurrency(safeDraft.costType) === "USD" ? "USD" : (expense.currency || "CNY");
	  return {
	    id: expense.id,
	    costType: safeDraft.costType,
	    amount: Number(safeDraft.unitAmount),
	    billingMethod: DEFAULT_BILLING_METHOD,
	    billingQuantity: Number(safeDraft.appliedContainerCount),
	    appliedContainerCount: billingQuantityLegacyInteger(safeDraft.appliedContainerCount),
	    currency,
	    exchangeRate: Number(expense.exchangeRate || 1),
	    remark: safeDraft.remark.trim(),
	  };
}

function logisticsExpenseDraftCreatePayload(expense: LogisticsExpense, draft?: LogisticsExpenseDraft): LogisticsExpenseBatchCreateItem {
  const safeDraft = draft || logisticsExpenseDraftFromItem(expense);
  const currency = logisticsCostTypeDefaultCurrency(safeDraft.costType) === "USD" ? "USD" : (expense.currency || "CNY");
	  return {
	    expenseType: safeDraft.costType,
	    amount: Number(safeDraft.unitAmount),
	    billingMethod: DEFAULT_BILLING_METHOD,
	    billingQuantity: Number(safeDraft.appliedContainerCount),
	    appliedContainerCount: billingQuantityLegacyInteger(safeDraft.appliedContainerCount),
	    currency,
	    exchangeRate: Number(expense.exchangeRate || 1),
	    remark: safeDraft.remark.trim(),
	  };
}

function logisticsExpenseDraftValidationMessage(expense: LogisticsExpense, draft: LogisticsExpenseDraft | undefined, index: number) {
	  const lineNo = index + 1;
	  if (!draft?.costType || !COST_TYPES.includes(draft.costType)) return `第 ${lineNo} 行请选择费用类型`;
	  if (!draft.unitAmount.trim()) return `第 ${lineNo} 行金额不能为空`;
	  const unitAmount = Number(draft.unitAmount);
	  if (!Number.isFinite(unitAmount) || unitAmount < 0) return `第 ${lineNo} 行金额必须大于或等于 0`;
	  if (expense.isTemporary && unitAmount <= 0) return `第 ${lineNo} 行金额必须大于 0`;
	  if (!validBillingQuantity(draft.appliedContainerCount)) return `第 ${lineNo} 行适用数量必须为正整数`;
	  return `第 ${lineNo} 行填写不完整`;
}

function editableNumberText(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function editableQuantityText(value: unknown) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric) || numeric <= 0) return "1";
  return String(Math.max(1, Math.round(numeric)));
}

function editableLineSubtotal(unitAmount: string, appliedContainerCount: string) {
  const unitPrice = Number(unitAmount || 0);
  const count = Number(appliedContainerCount || 1);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return unitPrice * (Number.isFinite(count) && count > 0 ? count : 1);
}

function createTemporaryLogisticsExpenseRow(expense: LogisticsExpense, items: LogisticsExpense[], index: number): LogisticsExpense {
  const base = items[0] || expense;
  const now = Date.now();
  return {
    id: `temp:${expense.id}:${now}:${index}`,
    isTemporary: true,
    orderId: expense.orderId || base.orderId,
    orderNo: expense.orderNo || base.orderNo,
    blNo: expense.blNo || expense.billOfLadingNo || base.blNo || base.billOfLadingNo,
    billOfLadingNo: expense.billOfLadingNo || expense.blNo || base.billOfLadingNo || base.blNo,
    customerName: expense.customerName || base.customerName,
    customerShortName: expense.customerShortName || base.customerShortName,
    supplierId: base.supplierId,
    supplierName: base.supplierName,
    costType: "拖车费",
    currency: base.currency || "CNY",
	    exchangeRate: Number(base.exchangeRate || 1),
	    amount: 0,
	    amountCny: 0,
	    appliedContainerCount: 1,
	    billingMethod: DEFAULT_BILLING_METHOD,
	    billingQuantity: 1,
	    remark: "",
    auditStatus: ["草稿", "已驳回"].includes(base.auditStatus || "") ? base.auditStatus : "草稿",
    invoiceStatus: "未通知",
    paymentStatus: "待开票",
    order: expense.order || base.order,
  };
}

function aggregateClientLogisticsExpenseStatus(items: LogisticsExpense[], field: keyof LogisticsExpense) {
  if (field === "auditStatus") return logisticsExpenseBillAuditStatus(items);
  if (field === "invoiceStatus") {
    const billValues = items.map(logisticsExpenseBillInvoiceStatusFromRow).filter(Boolean);
    if (billValues.length) return aggregateClientStatusValues(billValues, field);
  }
  if (field === "paymentStatus") {
    const billValues = items.map(logisticsExpenseBillPaymentStatusFromRow).filter(Boolean);
    if (billValues.length) return aggregateClientStatusValues(billValues, field);
  }
  return aggregateClientStatusValues(items.map((item) => item[field]).filter(Boolean).map(String), field);
}

function aggregateClientStatusValues(values: string[] = [], field: keyof LogisticsExpense | "invoiceStatus" | "paymentStatus") {
  const unique = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!unique.length) return "-";
  if (unique.length === 1) return unique[0];
  if (field === "invoiceStatus") {
    if (unique.includes("已上传")) return "部分已上传";
    if (unique.includes("已上传发票")) return "部分上传发票";
    if (unique.includes("已确认")) return "部分已确认";
    if (unique.includes("已确认发票")) return "部分已确认";
    if (unique.includes("已通知开票")) return "部分已通知";
    if (unique.includes("未通知")) return "部分未通知";
  }
  if (field === "paymentStatus") {
    if (unique.includes("已付款")) return "部分已付款";
    if (unique.includes("待付款")) return "部分待付款";
    if (unique.includes("已开票")) return "部分已开票";
    if (unique.includes("待开票")) return "部分待开票";
  }
  return "混合状态";
}

function logisticsInvoiceGroupsForBill(items: LogisticsExpense[]): LogisticsInvoiceGroupSummary[] {
  return logisticsInvoiceGroupsForExpenses(items).map((group) => {
    const groupItems = items.filter((item) => logisticsInvoiceGroupForExpense(item)?.key === group.key);
    const uploaded = groupItems.length > 0 && groupItems.every((item) => ["已上传", "已确认"].includes(logisticsExpenseDetailInvoiceStatus(item)));
    const confirmed = groupItems.length > 0 && groupItems.every((item) => logisticsExpenseDetailInvoiceStatus(item) === "已确认");
    const failed = groupItems.some((item) => logisticsExpenseDetailInvoiceStatus(item) === "通知失败");
    const notified = groupItems.some((item) => logisticsExpenseDetailInvoiceStatus(item) === "已通知开票");
    return {
      key: group.key,
      label: group.label,
      costTypes: group.costTypes,
      amountCny: groupItems.reduce((sum, item) => sum + Number(item.amountCny || 0), 0),
      currencyTotals: logisticsExpenseCurrencySummaryFromItems(groupItems),
      itemIds: groupItems.map((item) => item.id).filter(Boolean),
      status: confirmed ? "已确认" : (uploaded ? "已上传" : (failed ? "通知失败" : (notified ? "已通知开票" : "待开票"))),
      uploaded,
      confirmed,
      failed,
      notified,
      invoiceDocumentId: groupItems.find((item) => item.invoiceDocumentId)?.invoiceDocumentId || "",
      invoiceNotificationError: groupItems.map((item) => item.invoiceNotificationError || "").find(Boolean) || "",
    };
  });
}

function aggregateClientLogisticsInvoiceStatus(items: LogisticsExpense[]) {
  const groups = logisticsInvoiceGroupsForBill(items);
  if (!groups.length) return aggregateClientLogisticsExpenseStatus(items, "invoiceStatus");
  if (groups.every((group) => group.confirmed)) return "已确认";
  if (groups.every((group) => group.uploaded || group.confirmed)) return "已上传发票";
  if (groups.some((group) => group.uploaded || group.confirmed)) return "部分上传发票";
  if (groups.some((group) => group.failed)) return "待开票 / 通知失败";
  return "待开票";
}

function logisticsExpenseBillAuditStatusFromRow(expense: LogisticsExpense) {
  return String(expense.auditStatus || "草稿").trim() || "草稿";
}

function logisticsExpenseBillInvoiceStatusFromRow(expense: LogisticsExpense) {
  return String(expense.invoiceStatus || expense.billInvoiceStatus || "待开票").trim() || "待开票";
}

function logisticsExpenseBillPaymentStatusFromRow(expense: LogisticsExpense) {
  return String(expense.paymentStatus || expense.billPaymentStatus || "待开票").trim() || "待开票";
}

function logisticsExpenseDetailInvoiceStatus(expense: LogisticsExpense) {
  return String(expense.detailInvoiceStatus || "未通知").trim() || "未通知";
}

function logisticsExpenseBillItems(expense: LogisticsExpense) {
  return expense.items?.length ? expense.items : [expense];
}

function logisticsExpenseShipmentBillIds(expense: LogisticsExpense) {
  const ids = expense.shipmentBillIds?.length
    ? expense.shipmentBillIds
    : [expense.billId || expense.id];
  return [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
}

function logisticsExpenseSelectionSelected(expense: LogisticsExpense, selectedIds: string[]) {
  const ids = logisticsExpenseShipmentBillIds(expense);
  return ids.length > 0 && ids.every((id) => selectedIds.includes(id));
}

function defaultLogisticsExpenseDetailTab({
  auditStatus,
  invoiceStatus,
  paymentStatus,
}: {
  auditStatus?: string;
  invoiceStatus?: string;
  paymentStatus?: string;
}) {
  return logisticsBillDefaultTab({ auditStatus, invoiceStatus, paymentStatus });
}

function logisticsExpenseBillAuditStatus(items: LogisticsExpense[]) {
  const unique = [...new Set(items.map(logisticsExpenseBillAuditStatusFromRow).filter(Boolean))];
  if (!unique.length) return "草稿";
  if (unique.length === 1) return unique[0];
  if (unique.includes("审核通过")) return "审核通过";
  if (unique.includes("待审核")) return "待审核";
  if (unique.includes("已驳回")) return "已驳回";
  return "草稿";
}

function logisticsExpenseBillIsEditable(status: string) {
  return canSubmitLogisticsBill({ auditStatus: status });
}

function logisticsExpenseBillCanApprove(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  return canReviewLogisticsBill({ auditStatus: logisticsExpenseBillAuditStatusFromRow(expense) })
    || items.some((item) => canReviewLogisticsBill({ auditStatus: logisticsExpenseBillAuditStatusFromRow(item) }))
    || (items.length > 0 && canReviewLogisticsBill({ auditStatus: logisticsExpenseBillAuditStatus(items) }));
}

function logisticsExpenseBillCanSubmit(expense: LogisticsExpense) {
  const items = logisticsExpenseBillItems(expense);
  return items.length > 0 && logisticsExpenseBillIsEditable(logisticsExpenseBillAuditStatus(items));
}

function billSupplierIds(expense: LogisticsExpense) {
  return logisticsExpenseBillItems(expense)
    .map((item) => item.supplierId || item.supplierName || "")
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

function sortLogisticsExpenseBillsForDisplay(rows: LogisticsExpense[]) {
  return [...rows].sort((left, right) => {
    return logisticsExpenseBillSortRank(left) - logisticsExpenseBillSortRank(right)
      || logisticsExpenseBillUpdatedAtValue(right) - logisticsExpenseBillUpdatedAtValue(left);
  });
}

function logisticsExpenseBillSortRank(expense: LogisticsExpense) {
  const auditStatus = normalizeLogisticsExpenseSortStatus(logisticsExpenseBillAuditStatusFromRow(expense));
  if (["草稿", "已驳回", "待审核"].includes(auditStatus)) {
    return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] ?? 999;
  }

  const invoiceStatus = normalizeLogisticsExpenseSortStatus(logisticsExpenseBillInvoiceStatusFromRow(expense));
  const paymentStatus = normalizeLogisticsExpenseSortStatus(logisticsExpenseBillPaymentStatusFromRow(expense));
  const invoiceRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[invoiceStatus];
  if (Number.isFinite(invoiceRank) && invoiceRank < LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  if (["部分付款", "部分已付款"].includes(paymentStatus)) return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.部分付款;
  if (paymentStatus === "已付款") return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已付款;
  if (Number.isFinite(invoiceRank) && invoiceRank === LOGISTICS_EXPENSE_BILL_SORT_PRIORITY.已上传发票) return invoiceRank;
  const paymentRank = LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[paymentStatus];
  if (Number.isFinite(paymentRank)) return paymentRank;
  return LOGISTICS_EXPENSE_BILL_SORT_PRIORITY[auditStatus] ?? 999;
}

function normalizeLogisticsExpenseSortStatus(value: unknown) {
  const text = String(value || "").trim();
  if (text === "部分上传") return "部分上传发票";
  if (text === "已确认发票") return "已确认";
  if (text === "部分已付款") return "部分付款";
  return text || "草稿";
}

function logisticsExpenseBillUpdatedAtValue(expense: LogisticsExpense) {
  const value = expense.updatedAt || 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function removeLogisticsExpenseFromRows(rows: LogisticsExpense[], expenseId: string) {
  let removedBill = false;
  let billId = "";
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    if (!items.some((item) => item.id === expenseId)) return [row];
    billId = row.id;
    const nextItems = items.filter((item) => item.id !== expenseId);
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  return { rows: sortLogisticsExpenseBillsForDisplay(nextRows), removedBill, billId };
}

function replaceLogisticsExpenseItemsInRows(rows: LogisticsExpense[], savedItems: LogisticsExpense[]) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  return sortLogisticsExpenseBillsForDisplay(rows.map((row) => {
    const items = row.items?.length ? row.items : [row];
    if (!items.some((item) => savedById.has(item.id))) return row;
    const nextItems = items.map((item) => savedById.get(item.id) || item);
    return rebuildLogisticsExpenseBill(row, nextItems);
  }));
}

function normalizeLogisticsExpenseBillRow(bill: LogisticsExpense) {
  const items = bill.items?.length ? bill.items : [];
  return items.length ? rebuildLogisticsExpenseBill(bill, items) : bill;
}

function replaceLogisticsExpenseBillsInRows(rows: LogisticsExpense[], bills: LogisticsExpense[]) {
  if (!bills.length) return rows;
  const billById = new Map(bills.map((bill) => [bill.id, normalizeLogisticsExpenseBillRow(bill)]));
  return sortLogisticsExpenseBillsForDisplay(rows.map((row) => billById.get(row.id) || row));
}

function logisticsExpenseReviewResultLabel(result: LogisticsExpenseReviewResult) {
  const orderNo = result.orderNo || "";
  const blNo = result.blNo || "";
  const identity = [orderNo, blNo].filter(Boolean).join(" / ");
  return identity || result.billId || "账单";
}

function logisticsExpenseReviewFailureMessage(result: LogisticsExpenseMutationResult) {
  const failures = (result.results || []).filter((item) => item.auditStatus !== "审核通过" && item.errorMessage);
  if (!failures.length) return "";
  return failures.map((item) => `${logisticsExpenseReviewResultLabel(item)}：${item.errorMessage}`).join("；");
}

function logisticsExpenseReviewNotice(result: LogisticsExpenseMutationResult) {
  if (result.message) return result.message;
  if (result.emailError) return `费用已审核，开票通知发送失败，可稍后重发：${result.emailError}`;
  const successCount = Number(result.successCount || 0);
  if (successCount > 0) return `已审核 ${successCount} 票物流费用，开票通知已按供应商合并发送`;
  return "物流费用已审核，开票通知已按供应商合并发送";
}

function reconcileLogisticsExpenseMutationRows(rows: LogisticsExpense[], result: LogisticsExpenseMutationResult) {
  const bills = [
    ...(Array.isArray(result.bills) ? result.bills : []),
    ...(result.bill ? [result.bill] : []),
  ].filter(Boolean);
  if (bills.length) return replaceLogisticsExpenseBillsInRows(rows, bills);
  const savedItems = [
    ...(Array.isArray(result.expenses) ? result.expenses : []),
    ...(result.expense ? [result.expense] : []),
  ].filter(Boolean);
  if (savedItems.length) return replaceLogisticsExpenseItemsInRows(rows, savedItems);
  return rows;
}

function markLogisticsExpenseBillSubmitted(rows: LogisticsExpense[], billId: string, updatedIds: string[], submittedAt?: string) {
  const updatedIdSet = new Set(updatedIds.filter(Boolean));
  const submittedAtValue = submittedAt || new Date().toISOString();
  return sortLogisticsExpenseBillsForDisplay(rows.map((row) => {
    const items = row.items?.length ? row.items : [row];
    const belongsToBill = row.id === billId || items.some((item) => updatedIdSet.has(item.id));
    if (!belongsToBill) return row;
    const nextItems = items.map((item) => {
      return {
        ...item,
        auditStatus: "待审核",
        submittedAt: submittedAtValue,
        rejectReason: "",
        invoiceNotificationError: "",
      };
    });
    return rebuildLogisticsExpenseBill(row, nextItems);
  }));
}

function markLogisticsExpenseBillRejected(rows: LogisticsExpense[], billId: string, rejectReason: string) {
  const reviewedAt = new Date().toISOString();
  return sortLogisticsExpenseBillsForDisplay(rows.map((row) => {
    const items = row.items?.length ? row.items : [row];
    const belongsToBill = row.id === billId;
    if (!belongsToBill) return row;
    const nextItems = items.map((item) => ({
      ...item,
      auditStatus: "已驳回",
      invoiceStatus: "未通知",
      paymentStatus: "待开票",
      reviewedAt,
      rejectedAt: reviewedAt,
      rejectReason,
      invoiceNotifiedAt: null,
      invoiceNotificationError: "",
    }));
    return rebuildLogisticsExpenseBill(row, nextItems);
  }));
}

function reconcileLogisticsExpenseRowsAfterBatchSave(rows: LogisticsExpense[], billId: string, savedItems: LogisticsExpense[], deletedIds: string[]) {
  const savedById = new Map(savedItems.map((item) => [item.id, item]));
  const deletedIdSet = new Set(deletedIds);
  let matchedBill = false;
  let removedBill = false;
  const nextRows = rows.flatMap((row) => {
    const items = row.items?.length ? row.items : [row];
    const belongsToBill = row.id === billId || items.some((item) => savedById.has(item.id) || deletedIdSet.has(item.id));
    if (!belongsToBill) return [row];
    matchedBill = true;
    const nextItems = items
      .filter((item) => !deletedIdSet.has(item.id))
      .map((item) => savedById.get(item.id) || item);
    for (const savedItem of savedItems) {
      if (!nextItems.some((item) => item.id === savedItem.id)) nextItems.push(savedItem);
    }
    if (!nextItems.length) {
      removedBill = true;
      return [];
    }
    return [rebuildLogisticsExpenseBill(row, nextItems)];
  });
  if (!matchedBill && savedItems.length) {
    nextRows.unshift(buildLogisticsExpenseBillFromItems(savedItems));
  }
  return { rows: sortLogisticsExpenseBillsForDisplay(nextRows), removedBill };
}

function buildLogisticsExpenseBillFromItems(items: LogisticsExpense[]) {
  const first = items[0] || {};
  return rebuildLogisticsExpenseBill({
    id: logisticsExpenseBillIdFromItem(first),
    isBill: true,
    orderId: first.orderId,
    orderNo: first.orderNo,
    blNo: first.blNo || first.billOfLadingNo,
    billOfLadingNo: first.billOfLadingNo || first.blNo,
    customerName: first.customerName,
    customerShortName: first.customerShortName,
    order: first.order,
  } as LogisticsExpense, items);
}

function logisticsExpenseBillIdFromItem(item: Partial<LogisticsExpense>) {
  return `bill:${item.orderId || "order"}:${item.blNo || item.billOfLadingNo || item.orderNo || "no-bl"}`;
}

function rebuildLogisticsExpenseBill(row: LogisticsExpense, nextItems: LogisticsExpense[]) {
  const amountCny = nextItems.reduce((sum, item) => sum + Number(item.amountCny || 0), 0);
  const amount = nextItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const currencyTotals = logisticsExpenseCurrencySummaryFromItems(nextItems);
  const first = nextItems[0] || {};
  return {
    ...row,
    ...(
      nextItems.length === 1
        ? {
            costType: first.costType,
            currency: first.currency,
            exchangeRate: first.exchangeRate,
            amount,
          }
        : {
            costType: `${nextItems.length} 项费用`,
            amount: currencyTotals.cnyActual,
          }
    ),
    amountCny,
    currencyTotals,
    auditStatus: aggregateClientLogisticsExpenseStatus(nextItems, "auditStatus"),
    invoiceStatus: aggregateClientLogisticsInvoiceStatus(nextItems),
    paymentStatus: aggregateClientLogisticsExpenseStatus(nextItems, "paymentStatus"),
    itemCount: nextItems.length,
    invoiceGroups: logisticsInvoiceGroupsForBill(nextItems),
    supplierNames: [...new Set(nextItems.map((item) => item.supplierName).filter(Boolean))],
    items: nextItems,
  } as LogisticsExpense;
}

function expenseCostSyncText(expense: LogisticsExpense) {
  const status = String((expense as LogisticsExpense & { costSyncStatus?: string }).costSyncStatus || "").trim();
  if (["未同步", "已同步", "同步失败"].includes(status)) return status;
  return expense.costId ? "已同步" : "未同步";
}

function logisticsExpenseEditBlockReason(expense: LogisticsExpense) {
  const auditStatus = logisticsExpenseBillAuditStatusFromRow(expense);
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  return logisticsBillEditBlockReason({
    auditStatus,
    invoiceStatus,
    paymentStatus,
    costSynced: Boolean(expense.costId),
  }).replace(/。$/, "");
}

function logisticsExpenseDeleteBlockReason(expense: LogisticsExpense) {
  const auditStatus = logisticsExpenseBillAuditStatusFromRow(expense);
  const invoiceStatus = logisticsExpenseDetailInvoiceStatus(expense);
  const paymentStatus = logisticsExpenseBillPaymentStatusFromRow(expense);
  return logisticsBillDeleteBlockReason({
    auditStatus,
    invoiceStatus,
    paymentStatus,
    costSynced: Boolean(expense.costId),
  });
}

function csvCell(value: string) {
  const escaped = value.replaceAll("\"", "\"\"");
  const safe = /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${safe}"`;
}
