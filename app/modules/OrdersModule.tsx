"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import {
  ConfirmationDialog,
  CurrencyTotalsDisplay,
  PaginationBar,
  useConfirmationDialog,
} from "../components";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import type { CurrencyTotals } from "../../lib/platform/currency-totals";
import styles from "../WorkspaceShell.module.css";
import { OrderDetailDrawer } from "./orders/detail-drawer";
import { QuickCreateOrderPanel } from "./orders/quick-order-panel";
import { OrderTableRows } from "./orders/table";
import {
  ORDER_STATUSES,
  PAGE_SIZE,
  type OrderRow,
  type OrdersResponse,
} from "./orders/model";

export function OrdersModule({
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
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<CurrencyTotals | null>(null);
  const [keyword, setKeyword] = useState("");
  const [submittedKeyword, setSubmittedKeyword] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [submittedOrderStatus, setSubmittedOrderStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [detailOrder, setDetailOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteOrders = canWritePermission(currentUser, permissions, "orders", ["管理员", "业务员"]);

  async function loadOrders(nextPage = page, nextKeyword = submittedKeyword, nextOrderStatus = submittedOrderStatus) {
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
      const result = await apiJson<OrdersResponse>(`/api/orders?${params}`);
      const data = result.data || {};
      setOrders(Array.isArray(data.rows) ? data.rows : Array.isArray(result.orders) ? result.orders : []);
      setSummary(data.summary || null);
      setTotal(Number(data.total ?? result.orders?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取应收订单失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders(1, "");
  }, []);

  useEffect(() => {
    const value = initialKeyword.trim();
    if (!initialOpenToken || !value) return;
    setKeyword(value);
    setSubmittedKeyword(value);
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, value, submittedOrderStatus);
  }, [initialKeyword, initialOpenToken]);

  useEffect(() => {
    const value = keyword.trim();
    if (value === submittedKeyword) return;
    const timer = window.setTimeout(() => {
      setSubmittedKeyword(value);
      setSubmittedOrderStatus(orderStatus);
      setDetailOrder(null);
      setNotice("");
      void loadOrders(1, value, orderStatus);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, orderStatus, submittedKeyword]);

  function submitSearch() {
    const value = keyword.trim();
    setSubmittedKeyword(value);
    setSubmittedOrderStatus(orderStatus);
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, value, orderStatus);
  }

  function resetSearch() {
    setKeyword("");
    setSubmittedKeyword("");
    setOrderStatus("");
    setSubmittedOrderStatus("");
    setDetailOrder(null);
    setNotice("");
    void loadOrders(1, "", "");
  }

  function gotoPage(nextPage: number) {
    setDetailOrder(null);
    setNotice("");
    void loadOrders(nextPage, submittedKeyword, submittedOrderStatus);
  }

  async function deleteOrder(order: OrderRow) {
    if (!canWriteOrders) {
      setError("当前账号没有权限删除应收订单");
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "确认删除该订单？",
      message: "删除后不会物理清除数据，但会从当前业务列表隐藏。",
      details: [`订单：${order.orderNo || "-"}`],
      confirmLabel: "删除订单",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(order.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(
        `/api/orders/${encodeURIComponent(order.id)}`,
        { method: "DELETE" },
      );
      if (result.success === false) throw new Error(result.message || "删除应收订单失败");
      setDetailOrder(null);
      setEditOrder(null);
      setCreateOpen(false);
      await loadOrders(page, submittedKeyword);
      setNotice(result.message || "订单已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除应收订单失败");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>应收订单</h2>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.primaryButtonCompact}
            type="button"
            onClick={() => {
              if (canWriteOrders) {
                setEditOrder(null);
                setCreateOpen((current) => !current);
              }
            }}
            disabled={!canWriteOrders}
          >
            {createOpen ? "收起新建" : "新建订单"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
              void loadOrders(page, submittedKeyword, submittedOrderStatus);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canWriteOrders && (createOpen || editOrder) ? (
        <QuickCreateOrderPanel
          initialOrder={editOrder}
          onCancel={() => {
            setCreateOpen(false);
            setEditOrder(null);
          }}
          onSaved={() => {
            setNotice(editOrder ? "订单已更新" : "订单已保存");
            setCreateOpen(false);
            setEditOrder(null);
            setDetailOrder(null);
            void loadOrders(1, submittedKeyword, submittedOrderStatus);
          }}
        />
      ) : null}

      <div className={styles.metricGrid} aria-label="应收汇总统计">
        <article className={`${styles.metricCard} ${styles.metricBlue}`}>
          <span>应收汇总</span>
          <div className={styles.metricValue}>
            <CurrencyTotalsDisplay
              summary={summary}
              cnyLabel="人民币实际应收"
              foreignLabel={(currency) => `${currency} 实际应收`}
              totalLabel="折人民币应收总额"
            />
          </div>
          <small>按当前筛选条件统计；结算看原币，财务分析看折人民币。</small>
        </article>
      </div>

      <div className={styles.listToolbar}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 业务员"
        />
        <select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)} disabled={loading}>
          <option value="">全部订单状态</option>
          {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={submitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={resetSearch} disabled={loading}>重置</button>
      </div>

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th className={styles.blNoColumn}>提单号</th>
              <th className={styles.amountColumn}>最终应收</th>
              <th className={styles.amountColumn}>已收</th>
              <th className={styles.amountColumn}>未收</th>
              <th>状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : orders.length ? orders.map((order) => (
              <OrderTableRows
                key={order.id}
                order={order}
                onViewDetail={() => setDetailOrder(order)}
                onEdit={() => {
                  if (!canWriteOrders) return;
                  setCreateOpen(false);
                  setEditOrder(order);
                  setDetailOrder(order);
                }}
                onDelete={() => void deleteOrder(order)}
                deleting={deletingId === order.id}
                canWrite={canWriteOrders}
              />
            )) : (
              <tr>
                <td colSpan={8}><div className={styles.emptyState}>未找到匹配的应收订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} onPage={gotoPage} />
      {detailOrder ? (
        <OrderDetailDrawer
          order={detailOrder}
          canWrite={canWriteOrders}
          deleting={deletingId === detailOrder.id}
          onEdit={() => {
            if (!canWriteOrders) return;
            setCreateOpen(false);
            setEditOrder(detailOrder);
          }}
          onDelete={() => void deleteOrder(detailOrder)}
          onClose={() => setDetailOrder(null)}
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
