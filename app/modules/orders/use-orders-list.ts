import { useEffect, useRef, useState } from "react";
import type { CurrencyTotals } from "../../../lib/platform/currency-totals";
import { apiJson } from "../../api";
import {
  PAGE_SIZE,
  type BusinessEntityOption,
  type OrderRow,
  type OrdersResponse,
} from "./model";

type BusinessEntitiesResponse = { entities?: BusinessEntityOption[] };

export function useOrdersList({
  initialKeyword,
  initialOpenToken,
}: {
  initialKeyword: string;
  initialOpenToken: number;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<CurrencyTotals | null>(null);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [submittedOrderStatus, setSubmittedOrderStatus] = useState("");
  const [businessEntityId, setBusinessEntityId] = useState("");
  const [submittedBusinessEntityId, setSubmittedBusinessEntityId] = useState("");
  const [businessEntities, setBusinessEntities] = useState<BusinessEntityOption[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const listRequestRef = useRef(0);

  async function loadOrders(
    nextPage = page,
    nextKeyword = submittedKeyword,
    nextOrderStatus = submittedOrderStatus,
    nextBusinessEntityId = submittedBusinessEntityId,
  ) {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        workspace: "1",
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      if (nextOrderStatus) params.set("orderStatus", nextOrderStatus);
      if (nextBusinessEntityId) params.set("businessEntityId", nextBusinessEntityId);
      const result = await apiJson<OrdersResponse>(`/api/orders?${params}`);
      if (requestId !== listRequestRef.current) return [];
      const data = result.data || {};
      const nextRows = Array.isArray(data.rows) ? data.rows : Array.isArray(result.orders) ? result.orders : [];
      setOrders(nextRows);
      setSummary(data.summary || null);
      setTotal(Number(data.total ?? result.orders?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      if (requestId === listRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : "读取应收订单失败");
      }
      return [];
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders(1, "");
    apiJson<BusinessEntitiesResponse>("/api/business-entities")
      .then((result) => setBusinessEntities(Array.isArray(result.entities) ? result.entities : []))
      .catch(() => setBusinessEntities([]));
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, value, submittedOrderStatus, submittedBusinessEntityId);
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setSubmittedOrderStatus(orderStatus);
      setSubmittedBusinessEntityId(businessEntityId);
      setDetailOrder(null);
      setNotice("");
      void loadOrders(1, value, orderStatus, businessEntityId);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, orderStatus, businessEntityId, submittedKeyword]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setSubmittedOrderStatus(orderStatus);
    setSubmittedBusinessEntityId(businessEntityId);
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, value, orderStatus, businessEntityId);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setOrderStatus("");
    setSubmittedOrderStatus("");
    setBusinessEntityId("");
    setSubmittedBusinessEntityId("");
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, "", "", "");
  }

  function gotoPage(nextPage: number) {
    setDetailOrder(null);
    setNotice("");
    void loadOrders(nextPage, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
  }

  return {
    orders, setOrders, summary,
    keyword, setKeyword, submittedKeyword,
    orderStatus, setOrderStatus, submittedOrderStatus,
    businessEntityId, setBusinessEntityId, submittedBusinessEntityId,
    businessEntities, page, setPage, total, setTotal, totalPages,
    detailOrder, setDetailOrder, loading, error, setError, notice, setNotice,
    loadOrders, submitSearch, resetSearch, gotoPage,
  };
}
