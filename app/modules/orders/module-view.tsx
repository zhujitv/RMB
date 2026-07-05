"use client";

import { ConfirmationDialog, CurrencyTotalsDisplay, PaginationBar, type ConfirmationDialogState } from "../../components";
import type { User } from "../../types";
import styles from "../../WorkspaceShell.module.css";
import { OrderDetailDrawer } from "./detail-drawer";
import { QuickCreateOrderPanel } from "./quick-order-panel";
import { OrderTableRows } from "./table";
import { ORDER_STATUSES, type BusinessEntityOption, type OrderRow } from "./model";
import type { CurrencyTotals } from "../../../lib/platform/currency-totals";

type OrdersModuleViewProps = {
  currentUser: User;
  orders: OrderRow[];
  summary: CurrencyTotals | null;
  keyword: string;
  orderStatus: string;
  businessEntityId: string;
  businessEntities: BusinessEntityOption[];
  page: number;
  total: number;
  totalPages: number;
  detailOrder: OrderRow | null;
  loading: boolean;
  error: string;
  notice: string;
  createOpen: boolean;
  editOrder: OrderRow | null;
  deletingId: string;
  repairingSalespeople: boolean;
  canWriteOrders: boolean;
  canManageOrderAssignments: boolean;
  confirmation: ConfirmationDialogState | null;
  editPanelRef: React.RefObject<HTMLDivElement | null>;
  onSetKeyword: (value: string) => void;
  onSetOrderStatus: (value: string) => void;
  onSetBusinessEntityId: (value: string) => void;
  onSubmitSearch: () => void;
  onResetSearch: () => void;
  onRefresh: () => void;
  onToggleCreate: () => void;
  onRepairSalespeople: () => void;
  onOrderSaved: (order?: OrderRow | null) => void;
  onOrderEditCancel: () => void;
  onPage: (page: number) => void;
  onSetDetailOrder: (order: OrderRow | null) => void;
  onEditOrder: (order: OrderRow | null, options?: { returnToDetail?: boolean }) => void;
  onDeleteOrder: (order: OrderRow) => void;
  onBusinessEntityTransferred: (orderId: string, patch: Partial<OrderRow>) => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};

export function OrdersModuleView({
  currentUser,
  orders,
  summary,
  keyword,
  orderStatus,
  businessEntityId,
  businessEntities,
  page,
  total,
  totalPages,
  detailOrder,
  loading,
  error,
  notice,
  createOpen,
  editOrder,
  deletingId,
  repairingSalespeople,
  canWriteOrders,
  canManageOrderAssignments,
  confirmation,
  editPanelRef,
  ...actions
}: OrdersModuleViewProps) {
  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>应收订单</h2>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.primaryButtonCompact} type="button" onClick={actions.onToggleCreate} disabled={!canWriteOrders}>
            {createOpen ? "收起新建" : "新建订单"}
          </button>
          {canManageOrderAssignments ? (
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={repairingSalespeople || loading}
              onClick={actions.onRepairSalespeople}
            >
              {repairingSalespeople ? "修正中..." : "修正业务员归属"}
            </button>
          ) : null}
          <button className={styles.secondaryButton} type="button" disabled={loading} onClick={actions.onRefresh}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canWriteOrders && (createOpen || editOrder) ? (
        <div ref={editPanelRef}>
          <QuickCreateOrderPanel
            initialOrder={editOrder}
            canManageOrderAssignments={canManageOrderAssignments}
            onCancel={actions.onOrderEditCancel}
            onSaved={(order) => actions.onOrderSaved(order)}
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
          onChange={(event) => actions.onSetKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") actions.onSubmitSearch();
          }}
          placeholder="搜索订单号 / 客户简称 / 客户全称 / 提单号 / 业务员"
        />
        <select value={orderStatus} onChange={(event) => actions.onSetOrderStatus(event.target.value)} disabled={loading}>
          <option value="">全部订单状态</option>
          {ORDER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select value={businessEntityId} onChange={(event) => actions.onSetBusinessEntityId(event.target.value)} disabled={loading}>
          <option value="">全部业务主体</option>
          {businessEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.displayName || entity.shortName || entity.name}</option>)}
        </select>
        <button className={styles.primaryButtonCompact} type="button" onClick={actions.onSubmitSearch} disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" onClick={actions.onResetSearch} disabled={loading}>重置</button>
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
              <OrderTableRows key={order.id} order={order} onViewDetail={() => actions.onSetDetailOrder(order)} />
            )) : (
              <tr>
                <td colSpan={9}><div className={styles.emptyState}>未找到匹配的应收订单</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} onPage={actions.onPage} />
      {detailOrder ? (
        <OrderDetailDrawer
          order={detailOrder}
          canWrite={canWriteOrders}
          canTransferBusinessEntity={currentUser.role === "管理员"}
          businessEntities={businessEntities}
          deleting={deletingId === detailOrder.id}
          onEdit={() => actions.onEditOrder(detailOrder, { returnToDetail: true })}
          onDelete={() => actions.onDeleteOrder(detailOrder)}
          onBusinessEntityTransferred={(patch) => actions.onBusinessEntityTransferred(detailOrder.id, patch)}
          onClose={() => actions.onSetDetailOrder(null)}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={actions.onCancelConfirmation}
          onConfirm={actions.onConfirmConfirmation}
          onInputChange={actions.onUpdateConfirmationInput}
        />
      ) : null}
    </section>
  );
}
