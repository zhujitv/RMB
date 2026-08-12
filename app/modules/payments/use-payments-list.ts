import { useEffect, useRef, useState } from "react";
import { apiJson } from "../../api";
import {
  PAGE_SIZE,
  emptyPaymentFilters,
  type PaymentFilters,
  type PaymentRow,
  type PaymentSummary,
  type PaymentsResponse,
} from "./types";

export function usePaymentsList(initialKeyword: string, initialOpenToken: number, initialPaymentId = "") {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<PaymentSummary>({});
  const [filters, setFilters] = useState<PaymentFilters>({ ...emptyPaymentFilters });
  const [submittedFilters, setSubmittedFilters] = useState<PaymentFilters>({ ...emptyPaymentFilters });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detailPayment, setDetailPayment] = useState<PaymentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentRow | null>(null);
  const listRequestRef = useRef(0);

  async function loadPayments(nextPage = page, nextFilters = submittedFilters, targetPaymentId = ""): Promise<PaymentRow[] | null> {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ workspace: "1", page: String(nextPage), pageSize: String(PAGE_SIZE) });
      if (targetPaymentId.trim()) params.set("paymentId", targetPaymentId.trim());
      if (nextFilters.keyword.trim()) params.set("keyword", nextFilters.keyword.trim());
      Object.entries(nextFilters).forEach(([key, value]) => {
        if (key === "keyword") return;
        const text = String(value || "").trim();
        if (text) params.set(key, text);
      });
      const result = await apiJson<PaymentsResponse>(`/api/payments?${params}`);
      if (requestId !== listRequestRef.current) return null;
      const data = result.data || {};
      const nextRows = Array.isArray(data.rows)
        ? data.rows
        : Array.isArray(result.payments) ? result.payments : [];
      setPayments(nextRows);
      setSummary(data.summary || result.summary || {});
      setTotal(Number(data.total ?? result.payments?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取收款明细失败");
      }
      return null;
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => { void loadPayments(1, { ...emptyPaymentFilters }); }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    const targetPaymentId = initialPaymentId.trim();
    if (!initialOpenToken || (!value && !targetPaymentId)) return;
    const nextFilters = { ...emptyPaymentFilters, keyword: value };
    setFilters(nextFilters);
    setSubmittedFilters(nextFilters);
    setDetailPayment(null);
    setNotice("");
    void loadPayments(1, nextFilters, targetPaymentId).then((nextRows) => {
      if (!targetPaymentId || !nextRows) return;
      const target = nextRows.find((payment) => payment.id === targetPaymentId) || null;
      setDetailPayment(target);
      if (!target) setError("该收款记录不存在或当前账号无权查看。");
    });
  }, [initialKeyword, initialOpenToken, initialPaymentId]);

  useEffect(() => {
    const value = filters.keyword.trim();
    if (value === submittedFilters.keyword) return;
    const timer = window.setTimeout(() => {
      const nextFilters = {
        ...filters,
        keyword: value,
        month: filters.month.trim(),
        currency: filters.currency.trim(),
        paymentType: filters.paymentType.trim(),
        paymentStatus: filters.paymentStatus.trim(),
      };
      setSubmittedFilters(nextFilters);
      setDetailPayment(null);
      setNotice("");
      void loadPayments(1, nextFilters);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.keyword, filters.month, filters.currency, filters.paymentType, filters.paymentStatus, submittedFilters.keyword]);

  function setFilter<K extends keyof PaymentFilters>(key: K, value: PaymentFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function submitSearch() {
    setDetailPayment(null);
    setNotice("");
    const nextFilters = Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [key, String(value || "").trim()]),
    ) as PaymentFilters;
    setSubmittedFilters(nextFilters);
    void loadPayments(1, nextFilters);
  }

  function resetSearch() {
    setFilters({ ...emptyPaymentFilters });
    setSubmittedFilters({ ...emptyPaymentFilters });
    setDetailPayment(null);
    setNotice("");
    void loadPayments(1, { ...emptyPaymentFilters });
  }

  function gotoPage(nextPage: number) {
    setDetailPayment(null);
    setNotice("");
    void loadPayments(nextPage, submittedFilters);
  }

  function paymentMatchesSubmittedFilters(payment: PaymentRow) {
    const normalize = (value: unknown) => String(value || "").trim().toLowerCase();
    const keywordValue = normalize(submittedFilters.keyword);
    if (keywordValue) {
      const haystack = [payment.orderNo, payment.customerName, payment.customerFullName,
      payment.customerShortName, payment.bankReference, payment.remark].map(normalize).join(" ");
      if (!haystack.includes(keywordValue)) return false;
    }
    if (submittedFilters.month && !String(payment.paymentDate || "").startsWith(submittedFilters.month)) return false;
    if (submittedFilters.currency && payment.currency !== submittedFilters.currency) return false;
    if (submittedFilters.paymentType && payment.paymentType !== submittedFilters.paymentType) return false;
    if (submittedFilters.paymentStatus && payment.status !== submittedFilters.paymentStatus) return false;
    return true;
  }

  function mergePaymentRow(payment: PaymentRow, options: { shouldShow?: boolean } = {}) {
    const shouldShow = options.shouldShow ?? paymentMatchesSubmittedFilters(payment);
    setPayments((current) => {
      const exists = current.some((item) => item.id === payment.id);
      if (exists) return shouldShow
        ? current.map((item) => item.id === payment.id ? { ...item, ...payment } : item)
        : current.filter((item) => item.id !== payment.id);
      return page === 1 && shouldShow ? [payment, ...current].slice(0, PAGE_SIZE) : current;
    });
    setDetailPayment((current) => current?.id === payment.id ? { ...current, ...payment } : current);
    setEditPayment((current) => current?.id === payment.id ? { ...current, ...payment } : current);
  }

  return {
    payments, summary, filters, submittedFilters, page, total, totalPages,
    detailPayment, setDetailPayment, loading, error, setError, notice, setNotice,
    createOpen, setCreateOpen, editPayment, setEditPayment, setTotal, loadPayments,
    setFilter, submitSearch, resetSearch, gotoPage, paymentMatchesSubmittedFilters,
    mergePaymentRow,
  };
}
