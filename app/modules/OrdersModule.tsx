"use client";

import { useEffect, useRef, useState } from "react";
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
  type BusinessEntityOption,
  type OrderRow,
  type OrdersResponse,
} from "./orders/model";

type BusinessEntitiesResponse = {
  entities?: BusinessEntityOption[];
};

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
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [returnDetailOrder, setReturnDetailOrder] = useState<OrderRow | null>(null);
  const [deletingId, setDeletingId] = useState("");
  const [repairingSalespeople, setRepairingSalespeople] = useState(false);
  const editPanelRef = useRef<HTMLDivElement | null>(null);
  const {
    confirmation,
    requestConfirmation,
    cancelConfirmation,
    confirmConfirmation,
    updateConfirmationInput,
  } = useConfirmationDialog();
  const canWriteOrders = canWritePermission(currentUser, permissions, "orders", ["管理员", "业务员"]);
  const canManageOrderAssignments = currentUser.role === "管理员";

  async function loadOrders(nextPage = page, nextKeyword = submittedKeyword, nextOrderStatus = submittedOrderStatus, nextBusinessEntityId = submittedBusinessEntityId) {
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
      const data = result.data || {};
      const nextRows = Array.isArray(data.rows) ? data.rows : Array.isArray(result.orders) ? result.orders : [];
      setOrders(nextRows);
      setSummary(data.summary || null);
      setTotal(Number(data.total ?? result.orders?.length ?? 0));
      setPage(Number(data.page || nextPage));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取应收订单失败");
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders(1, "");
    void loadBusinessEntities();
  }, []);

  async function loadBusinessEntities() {
    try {
      const result = await apiJson<BusinessEntitiesResponse>("/api/business-entities");
      setBusinessEntities(Array.isArray(result.entities) ? result.entities : []);
    } catch {
      setBusinessEntities([]);
    }
  }

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

  function scrollToEditPanel() {
    window.requestAnimationFrame(() => {
      editPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function openEditOrder(order: OrderRow | null, options: { returnToDetail?: boolean } = {}) {
    if (!canWriteOrders) {
      setError("权限不足，不能编辑");
      return;
    }
    if (!order?.id) {
      setError("数据加载失败，不能编辑");
      return;
    }
    setError("");
    setNotice("");
    setCreateOpen(false);
    setEditOrder(order);
    setReturnDetailOrder(options.returnToDetail ? order : null);
    setDetailOrder(null);
    scrollToEditPanel();
  }

  function normalizedSearchText(value: unknown) {
    return String(value || "").trim().toLowerCase();
  }

  function orderMatchesSubmittedFilters(order: OrderRow) {
    const keywordValue = normalizedSearchText(submittedKeyword);
    if (keywordValue) {
      const haystack = [
        order.orderNo,
        order.blNo,
        order.billOfLadingNo,
        order.customerName,
        order.customerFullName,
        order.customerShortName,
        order.salespersonName,
        order.remark,
      ].map(normalizedSearchText).join(" ");
      if (!haystack.includes(keywordValue)) return false;
    }
    if (submittedOrderStatus && order.status !== submittedOrderStatus) return false;
    if (submittedBusinessEntityId && order.businessEntityId !== submittedBusinessEntityId) return false;
    return true;
  }

  function mergeOrderRow(order: OrderRow, options: { shouldShow?: boolean } = {}) {
    const shouldShow = options.shouldShow ?? orderMatchesSubmittedFilters(order);
    setOrders((current) => {
      const exists = current.some((item) => item.id === order.id);
      if (exists) {
        return shouldShow
          ? current.map((item) => item.id === order.id ? { ...item, ...order } : item)
          : current.filter((item) => item.id !== order.id);
      }
      return page === 1 && shouldShow ? [order, ...current].slice(0, PAGE_SIZE) : current;
    });
    setDetailOrder((current) => current?.id === order.id ? { ...current, ...order } : current);
    setEditOrder((current) => current?.id === order.id ? { ...current, ...order } : current);
  }

  async function handleOrderSaved(order?: OrderRow | null) {
    const savedOrder = editOrder;
    const detailToRestore = returnDetailOrder;
    setNotice(savedOrder ? "订单已更新" : "订单已保存");
    setCreateOpen(false);
    setEditOrder(null);
    setReturnDetailOrder(null);
    if (order?.id) {
      const existedInRows = orders.some((item) => item.id === order.id);
      const shouldShow = orderMatchesSubmittedFilters(order);
      mergeOrderRow(order, { shouldShow });
      if (!savedOrder && shouldShow) setTotal((current) => current + 1);
      if (savedOrder && existedInRows && !shouldShow) setTotal((current) => Math.max(0, current - 1));
    }
    if (savedOrder && detailToRestore) {
      setDetailOrder(order?.id ? { ...detailToRestore, ...order } : detailToRestore);
    } else {
      setDetailOrder(null);
    }
  }

  function handleOrderEditCancel() {
    const detailToRestore = returnDetailOrder;
    setCreateOpen(false);
    setEditOrder(null);
    setReturnDetailOrder(null);
    if (detailToRestore) setDetailOrder(detailToRestore);
  }

  function applyOrderPatch(orderId: string, patch: Partial<OrderRow>) {
    setOrders((current) => current.map((order) => order.id === orderId ? { ...order, ...patch } : order));
    setDetailOrder((current) => current && current.id === orderId ? { ...current, ...patch } : current);
    setEditOrder((current) => current && current.id === orderId ? { ...current, ...patch } : current);
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
      await loadOrders(page, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
      setNotice(result.message || "订单已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除应收订单失败");
    } finally {
      setDeletingId("");
    }
  }

  async function repairMissingSalespeople() {
    if (!canManageOrderAssignments) return;
    const confirmationResult = await requestConfirmation({
      title: "确认修正历史订单业务员归属？",
      message: "系统只处理业务员为空的历史订单，不会覆盖已经明确分配过业务员的订单。",
      details: [
        "优先使用客户资料中的负责业务员。",
        "客户未配置时，才使用业务员创建人作为兜底。",
      ],
      confirmLabel: "开始修正",
      cancelLabel: "取消",
    });
    if (!confirmationResult.confirmed) return;
    setRepairingSalespeople(true);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{
        success?: boolean;
        message?: string;
        data?: { scanned?: number; repaired?: number; unresolved?: number };
      }>("/api/orders/salesperson-repair", { method: "POST" });
      if (result.success === false) throw new Error(result.message || "修正历史订单业务员失败");
      const stats = result.data || {};
      setNotice(result.message || `历史订单业务员修正完成：扫描 ${stats.scanned || 0} 条，修复 ${stats.repaired || 0} 条，无法修复 ${stats.unresolved || 0} 条。`);
      await loadOrders(page, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : "修正历史订单业务员失败");
    } finally {
      setRepairingSalespeople(false);
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
                setReturnDetailOrder(null);
                setDetailOrder(null);
                setCreateOpen((current) => !current);
                window.requestAnimationFrame(() => {
                  if (!createOpen) scrollToEditPanel();
                });
              }
            }}
            disabled={!canWriteOrders}
          >
            {createOpen ? "收起新建" : "新建订单"}
          </button>
          {canManageOrderAssignments ? (
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={repairingSalespeople || loading}
              onClick={() => void repairMissingSalespeople()}
            >
              {repairingSalespeople ? "修正中..." : "修正业务员归属"}
            </button>
          ) : null}
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              setNotice("");
            void loadOrders(page, submittedKeyword, submittedOrderStatus, submittedBusinessEntityId);
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canWriteOrders && (createOpen || editOrder) ? (
        <div ref={editPanelRef}>
          <QuickCreateOrderPanel
            initialOrder={editOrder}
            canManageOrderAssignments={canManageOrderAssignments}
            onCancel={handleOrderEditCancel}
            onSaved={(order) => void handleOrderSaved(order)}
          />
        </div>
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
        <select value={businessEntityId} onChange={(event) => setBusinessEntityId(event.target.value)} disabled={loading}>
          <option value="">全部业务主体</option>
          {businessEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName || entity.shortName || entity.name}</option>)}
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
              <th className={styles.businessEntityColumn}>业务主体</th>
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
                <td colSpan={9}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : orders.length ? orders.map((order) => (
              <OrderTableRows
                key={order.id}
                order={order}
                onViewDetail={() => setDetailOrder(order)}
              />
            )) : (
              <tr>
                <td colSpan={9}><div className={styles.emptyState}>未找到匹配的应收订单</div></td>
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
          canTransferBusinessEntity={currentUser.role === "管理员"}
          businessEntities={businessEntities}
          deleting={deletingId === detailOrder.id}
          onEdit={() => openEditOrder(detailOrder, { returnToDetail: true })}
          onDelete={() => void deleteOrder(detailOrder)}
          onBusinessEntityTransferred={(patch) => applyOrderPatch(detailOrder.id, patch)}
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
