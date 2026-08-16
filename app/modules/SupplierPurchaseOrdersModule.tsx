"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../api";
import {
  useWorkspaceTabBusy,
  useWorkspaceTabPresentation,
  useWorkspaceTabReactivation,
} from "../workspace/workspace-tab-context";
import styles from "./supplier-purchase-orders/supplier-purchase-orders.module.css";
import { SupplierPurchaseOrderDetail } from "./supplier-purchase-orders/purchase-order-detail";
import { SupplierPurchaseOrderList } from "./supplier-purchase-orders/purchase-order-list";
import { dateInputValue, isValidSupplierUnitPrice } from "./supplier-purchase-orders/presentation";
import type {
  SupplierPurchaseOrderDetailResponse,
  SupplierPurchaseOrderDto,
  SupplierPurchaseOrderListResponse,
  SupplierPurchaseOrderResponseAction,
} from "./supplier-purchase-orders/types";

export function SupplierPurchaseOrdersModule({
  canWrite,
  initialKeyword = "",
  initialPurchaseOrderId = "",
  initialOpenToken = 0,
}: {
  canWrite: boolean;
  initialKeyword?: string;
  initialPurchaseOrderId?: string;
  initialOpenToken?: number;
}) {
  const [rows, setRows] = useState<SupplierPurchaseOrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [keyword, setKeyword] = useState(initialKeyword);
  const [submittedKeyword, setSubmittedKeyword] = useState(initialKeyword.trim());
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detail, setDetail] = useState<SupplierPurchaseOrderDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [responseAction, setResponseAction] = useState<SupplierPurchaseOrderResponseAction>("ACCEPTED");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [remark, setRemark] = useState("");
  const [itemPrices, setItemPrices] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [productionCompleting, setProductionCompleting] = useState(false);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const responseBusyRef = useRef(false);
  const productionCompletionBusyRef = useRef(false);

  useWorkspaceTabBusy(submitting || productionCompleting);
  useWorkspaceTabPresentation({
    title: detail ? `工厂采购单 · ${detail.poNo}` : "工厂采购单",
    view: detail ? "detail" : "list",
    contextKey: detail ? `supplier-purchase-order:${detail.id}` : "list:supplier-purchase-orders",
    ensureListTab: Boolean(detail),
  });

  const loadRows = useCallback(async (nextPage = page, nextKeyword = submittedKeyword, nextStatus = status) => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setListError("");
    const params = new URLSearchParams({ page: String(nextPage), pageSize: "20" });
    if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
    if (nextStatus) params.set("status", nextStatus);
    try {
      const result = await apiJson<SupplierPurchaseOrderListResponse>(`/api/supplier-purchase-orders?${params.toString()}`);
      if (requestId !== listRequestRef.current) return;
      const nextRows = result.purchaseOrders || result.data || [];
      setRows(nextRows);
      setPage(result.pagination?.page || nextPage);
      setTotal(result.pagination?.total || 0);
      setTotalPages(Math.max(1, result.pagination?.totalPages || 1));
    } catch (error: unknown) {
      if (requestId === listRequestRef.current) {
        setListError(error instanceof Error ? error.message : "读取工厂采购单失败");
      }
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }, [page, status, submittedKeyword]);

  const openPurchaseOrder = useCallback(async (purchaseOrderId: string) => {
    const requestId = ++detailRequestRef.current;
    setDetailLoading(true);
    setDetailError("");
    setNotice("");
    try {
      const result = await apiJson<SupplierPurchaseOrderDetailResponse>(
        `/api/supplier-purchase-orders/${encodeURIComponent(purchaseOrderId)}`,
      );
      if (requestId !== detailRequestRef.current) return;
      const purchaseOrder = result.purchaseOrder || result.data;
      if (!purchaseOrder) throw new Error("采购单详情不存在");
      setDetail(purchaseOrder);
      setResponseAction("ACCEPTED");
      setDeliveryDate(dateInputValue(purchaseOrder.requestedDeliveryDate));
      setRemark("");
      setItemPrices(Object.fromEntries(purchaseOrder.items.map((item) => [item.id, item.unitPrice || ""])));
      if (purchaseOrder.status === "ACCEPTED") {
        setResponseAction("DELIVERY_PROPOSED");
        setDeliveryDate("");
      }
    } catch (error: unknown) {
      if (requestId === detailRequestRef.current) {
        setDetail(null);
        setDetailError(error instanceof Error ? error.message : "读取工厂采购单详情失败");
      }
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows(1, initialKeyword.trim(), "");
  }, []);

  useEffect(() => {
    if (!initialOpenToken || !initialPurchaseOrderId.trim()) return;
    void openPurchaseOrder(initialPurchaseOrderId.trim());
  }, [initialOpenToken, initialPurchaseOrderId, openPurchaseOrder]);

  useWorkspaceTabReactivation(() => {
    void loadRows(page, submittedKeyword, status);
    if (detail?.id) void openPurchaseOrder(detail.id);
  });

  const canSubmit = useMemo(() => {
    if (!canWrite || !detail || detail.deliveryFrozen || detail.status === "REJECTED" || detail.status === "DELIVERY_PROPOSED" || submitting || productionCompleting) return false;
    const pricesComplete = responseAction === "REJECTED" || detail.items.every(
      (item) => !item.priceRequired || isValidSupplierUnitPrice(itemPrices[item.id]),
    );
    if (!pricesComplete) return false;
    if (detail.status !== "DISPATCHED" && responseAction !== "DELIVERY_PROPOSED") return false;
    if (responseAction === "ACCEPTED") return Boolean(deliveryDate);
    if (responseAction === "DELIVERY_PROPOSED") {
      const currentDate = dateInputValue(detail.supplierDeliveryDate || detail.requestedDeliveryDate);
      return Boolean(deliveryDate && remark.trim() && deliveryDate !== currentDate);
    }
    return Boolean(remark.trim());
  }, [canWrite, deliveryDate, detail, itemPrices, productionCompleting, remark, responseAction, submitting]);

  function selectResponseAction(action: SupplierPurchaseOrderResponseAction) {
    setResponseAction(action);
    setNotice("");
    setDetailError("");
    if (action === "ACCEPTED") setDeliveryDate(dateInputValue(detail?.requestedDeliveryDate));
    if (action === "DELIVERY_PROPOSED") setDeliveryDate("");
    if (action === "REJECTED") setDeliveryDate("");
  }

  async function submitResponse() {
    if (!canWrite || !detail || !canSubmit || responseBusyRef.current) return;
    const requestId = ++detailRequestRef.current;
    const purchaseOrderId = detail.id;
    responseBusyRef.current = true;
    setSubmitting(true);
    setDetailError("");
    setNotice("");
    try {
      const result = await apiJson<SupplierPurchaseOrderDetailResponse>(
        `/api/supplier-purchase-orders/${encodeURIComponent(purchaseOrderId)}/response`,
        {
          method: "POST",
          body: JSON.stringify({
            action: responseAction,
            expectedRevision: detail.revision,
            ...(responseAction === "REJECTED" ? {} : { deliveryDate }),
            ...(responseAction === "REJECTED" ? {} : {
              itemPrices: detail.items
                .filter((item) => item.priceRequired)
                .map((item) => ({ purchaseOrderItemId: item.id, unitPrice: itemPrices[item.id] || "" })),
            }),
            remark: remark.trim(),
          }),
        },
      );
      if (requestId !== detailRequestRef.current) return;
      const saved = result.purchaseOrder || result.data;
      if (!saved) throw new Error("采购单回复结果缺失，请刷新后确认");
      setDetail(saved);
      setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
      setNotice(result.message || "采购单回复已提交");
      setItemPrices(Object.fromEntries(saved.items.map((item) => [item.id, item.unitPrice || ""])));
      if (saved.status === "ACCEPTED") {
        setResponseAction("DELIVERY_PROPOSED");
        setDeliveryDate("");
        setRemark("");
      }
      void loadRows(page, submittedKeyword, status);
    } catch (error: unknown) {
      if (requestId === detailRequestRef.current) {
        setDetailError(error instanceof Error ? error.message : "提交工厂采购单回复失败");
      }
    } finally {
      responseBusyRef.current = false;
      if (requestId === detailRequestRef.current) setSubmitting(false);
    }
  }

  async function confirmProductionCompletion() {
    if (!canWrite || !detail || detail.status !== "ACCEPTED" || detail.productionStatus !== "IN_PRODUCTION" || submitting || productionCompletionBusyRef.current) return;
    const requestId = ++detailRequestRef.current;
    const purchaseOrderId = detail.id;
    productionCompletionBusyRef.current = true;
    setProductionCompleting(true);
    setDetailError("");
    setNotice("");
    try {
      const result = await apiJson<SupplierPurchaseOrderDetailResponse>(
        `/api/supplier-purchase-orders/${encodeURIComponent(purchaseOrderId)}/production-completion`,
        {
          method: "POST",
          body: JSON.stringify({ expectedRevision: detail.revision }),
        },
      );
      if (requestId !== detailRequestRef.current) return;
      const saved = result.purchaseOrder || result.data;
      if (!saved) throw new Error("生产完成确认结果缺失，请刷新后确认");
      setDetail(saved);
      setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
      setNotice(result.message || "生产完成已确认");
      void loadRows(page, submittedKeyword, status);
    } catch (error: unknown) {
      if (requestId === detailRequestRef.current) {
        setDetailError(error instanceof Error ? error.message : "确认生产完成失败");
      }
    } finally {
      productionCompletionBusyRef.current = false;
      setProductionCompleting(false);
    }
  }

  if (detailLoading && !detail) {
    return <section className={styles.module}><div className={styles.loading}>正在读取采购单详情...</div></section>;
  }

  if (detail) {
    return (
      <SupplierPurchaseOrderDetail
        canWrite={canWrite}
        detail={detail}
        error={detailError}
        notice={notice}
        responseAction={responseAction}
        deliveryDate={deliveryDate}
        remark={remark}
        itemPrices={itemPrices}
        canSubmit={canSubmit}
        submitting={submitting}
        productionCompleting={productionCompleting}
        onBack={() => { detailRequestRef.current += 1; responseBusyRef.current = false; productionCompletionBusyRef.current = false; setSubmitting(false); setProductionCompleting(false); setDetail(null); setDetailError(""); setNotice(""); }}
        onActionChange={selectResponseAction}
        onDeliveryDateChange={setDeliveryDate}
        onRemarkChange={setRemark}
        onItemPriceChange={(itemId, value) => setItemPrices((current) => ({ ...current, [itemId]: value }))}
        onSubmit={() => void submitResponse()}
        onProductionProgressSaved={(saved, message) => {
          setDetail(saved);
          setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
          setNotice(message);
          void loadRows(page, submittedKeyword, status);
        }}
        onConfirmProductionCompletion={() => void confirmProductionCompletion()}
      />
    );
  }

  return (
    <SupplierPurchaseOrderList
      rows={rows}
      loading={loading}
      error={listError || detailError}
      keyword={keyword}
      status={status}
      page={page}
      total={total}
      totalPages={totalPages}
      onKeywordChange={setKeyword}
      onStatusChange={(nextStatus) => {
        setStatus(nextStatus);
        setPage(1);
        void loadRows(1, submittedKeyword, nextStatus);
      }}
      onSearch={(nextKeyword) => {
        setSubmittedKeyword(nextKeyword);
        setPage(1);
        void loadRows(1, nextKeyword, status);
      }}
      onRefresh={() => void loadRows(page, submittedKeyword, status)}
      onPageChange={(nextPage) => void loadRows(nextPage, submittedKeyword, status)}
      onOpen={(id) => void openPurchaseOrder(id)}
    />
  );
}
