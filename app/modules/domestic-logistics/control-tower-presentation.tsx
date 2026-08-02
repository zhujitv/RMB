import { Fragment } from "react";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { getBusinessEntityRowClass } from "../business-entity-row-style";
import {
  ControlTowerDetailPanel,
  ControlTowerStatCard,
  ControlTowerTimeline,
  ControlTowerTooltip,
  ShipsgoMapAction,
  controlTowerAlertClass,
  controlTowerNodeClass,
  controlTowerStatusClass,
  controlTowerStatusText,
} from "./control-tower-components";
import type { ShipsgoControlTowerFilters, ShipsgoControlTowerRow, ShipsgoControlTowerStats, ShipsgoFeatureFlags } from "./model";
import { shipsgoCarrierText, shipsgoPortText, shipsgoVesselVoyage } from "./shipsgo-format";

export function ControlTowerPresentation({
  fullScreen, updatedAt, submittedFilters, loading, stats, filters, error, notice,
  rows, selectedRow, canManage, features, syncingId, expandedId,
  loadControlTower, setFullScreen, setFilterValue, submitFilters, resetFilters,
  setSelectedId, syncTracking, onOpenOrder, toggleTimeline,
}: {
  fullScreen: boolean;
  updatedAt: string;
  submittedFilters: ShipsgoControlTowerFilters;
  loading: boolean;
  stats: ShipsgoControlTowerStats;
  filters: ShipsgoControlTowerFilters;
  error: string;
  notice: string;
  rows: ShipsgoControlTowerRow[];
  selectedRow: ShipsgoControlTowerRow | null;
  canManage: boolean;
  features: ShipsgoFeatureFlags;
  syncingId: string;
  expandedId: string;
  loadControlTower: (filters?: ShipsgoControlTowerFilters, quiet?: boolean) => Promise<void>;
  setFullScreen: (value: boolean | ((current: boolean) => boolean)) => void;
  setFilterValue: <K extends keyof ShipsgoControlTowerFilters>(key: K, value: ShipsgoControlTowerFilters[K]) => void;
  submitFilters: () => void;
  resetFilters: () => void;
  setSelectedId: (id: string) => void;
  syncTracking: (row: ShipsgoControlTowerRow) => Promise<void>;
  onOpenOrder: (row: ShipsgoControlTowerRow) => void;
  toggleTimeline: (row: ShipsgoControlTowerRow) => void;
}) {
  return (
    <div className={fullScreen ? styles.controlTowerFullscreen : styles.controlTowerShell}>
      <div className={styles.controlTowerHeader}>
        <div>
          <h3>运输监控</h3>
        </div>
        <div className={styles.controlTowerHeaderActions}>
          <span>最后更新时间：{updatedAt ? formatDateTime(updatedAt) : "暂无"}</span>
          <button className={styles.secondaryButton} type="button" onClick={() => void loadControlTower(submittedFilters)} disabled={loading}>
            {loading ? "刷新中..." : "刷新数据"}
          </button>
          <button className={styles.primaryButtonCompact} type="button" onClick={() => setFullScreen((current) => !current)}>
            {fullScreen ? "退出全屏" : "全屏查看"}
          </button>
        </div>
      </div>

      <div className={styles.controlTowerStats}>
        <ControlTowerStatCard label="在途总票数" value={stats.inTransitCount} tone="blue" />
        <ControlTowerStatCard label="甩柜预警" value={stats.dumpingWarningCount} tone="red" />
        <ControlTowerStatCard label="即将到港" value={stats.soonArrivingCount} tone="orange" />
        <ControlTowerStatCard label="ETA 已过期" value={stats.etaOverdueCount} tone="red" />
        <ControlTowerStatCard label="同步失败" value={stats.syncFailedCount} tone="rose" />
        <ControlTowerStatCard label="今日已同步" value={stats.syncedTodayCount} tone="green" />
      </div>

      {!fullScreen ? (
        <div className={styles.controlTowerFilters}>
          <input value={filters.customer} onChange={(event) => setFilterValue("customer", event.target.value)} placeholder="客户简称" aria-label="客户简称" />
          <input value={filters.orderNo} onChange={(event) => setFilterValue("orderNo", event.target.value)} placeholder="订单号" aria-label="订单号" />
          <input value={filters.masterBlNo} onChange={(event) => setFilterValue("masterBlNo", event.target.value)} placeholder="Master B/L" aria-label="Master B/L" />
          <input value={filters.carrier} onChange={(event) => setFilterValue("carrier", event.target.value)} placeholder="船公司" aria-label="船公司" />
          <input value={filters.origin} onChange={(event) => setFilterValue("origin", event.target.value)} placeholder="起运港" aria-label="起运港" />
          <input value={filters.destination} onChange={(event) => setFilterValue("destination", event.target.value)} placeholder="目的港" aria-label="目的港" />
          <select value={filters.status} onChange={(event) => setFilterValue("status", event.target.value)} aria-label="运输状态">
            <option value="">全部状态</option>
            <option value="航行中">航行中</option>
            <option value="已离港">已离港</option>
            <option value="已到港">已到港</option>
            <option value="待更新">待更新</option>
            <option value="甩柜预警">甩柜预警</option>
            <option value="同步失败">同步失败</option>
          </select>
          <input type="date" value={filters.etaStart} onChange={(event) => setFilterValue("etaStart", event.target.value)} aria-label="ETA 开始日期" />
          <input type="date" value={filters.etaEnd} onChange={(event) => setFilterValue("etaEnd", event.target.value)} aria-label="ETA 结束日期" />
          <select value={filters.overdue} onChange={(event) => setFilterValue("overdue", event.target.value)} aria-label="ETA 逾期状态">
            <option value="">是否逾期</option>
            <option value="true">ETA 已过期</option>
            <option value="false">未逾期</option>
          </select>
          <select value={filters.syncFailed} onChange={(event) => setFilterValue("syncFailed", event.target.value)} aria-label="同步状态">
            <option value="">同步状态</option>
            <option value="true">同步失败</option>
            <option value="false">同步正常</option>
          </select>
          <select value={filters.includeCompleted ? "true" : "false"} onChange={(event) => setFilterValue("includeCompleted", event.target.value === "true")} aria-label="完成状态显示范围">
            <option value="false">隐藏已到港/已完成</option>
            <option value="true">显示已到港/已完成</option>
          </select>
          <button className={styles.primaryButtonCompact} type="button" onClick={submitFilters} disabled={loading}>查询</button>
          <button className={styles.secondaryButton} type="button" onClick={resetFilters} disabled={loading}>重置</button>
        </div>
      ) : null}

      {error ? <div className={styles.inlineError}>{error}</div> : null}
      {notice ? <div className={styles.infoStrip}>{notice}</div> : null}

      {fullScreen ? (
        <div className={styles.controlTowerBigScreen} onClick={() => setSelectedId("")}>
          <div className={styles.controlTowerNodeBoard}>
            {rows.length ? rows.map((row) => (
              <button
                key={row.id}
                className={`${styles.controlTowerNodeCard} ${controlTowerNodeClass(row)}`}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(row.id);
                }}
              >
                <div className={styles.controlTowerNodeTop}>
                  <span className={`${styles.statusPill} ${controlTowerStatusClass(row)}`}>{controlTowerStatusText(row)}</span>
                  <strong>{row.orderNo || "-"}</strong>
                </div>
                <div className={styles.controlTowerRouteLine}>
                  <span>{shipsgoPortText(row.originPortName || row.originName, row.originPortCode)}</span>
                  <span>{row.latestNodeDescription || "当前节点待更新"}</span>
                  <span>{shipsgoPortText(row.destinationPortName || row.destinationName, row.destinationPortCode)}</span>
                </div>
                <div className={styles.controlTowerNodeMeta}>
                  <span>ETA：{row.eta || "暂无 ETA"}</span>
                  <span>{shipsgoVesselVoyage(row)}</span>
                </div>
                <ControlTowerTooltip row={row} />
              </button>
            )) : <div className={styles.emptyState}>暂无在途海运跟踪</div>}
          </div>
          {selectedRow ? (
            <ControlTowerDetailPanel
              row={selectedRow}
              canManage={canManage}
              features={features}
              syncing={Boolean(syncingId)}
              navigationDisabled={Boolean(syncingId)}
              onSync={() => void syncTracking(selectedRow)}
              onOpenOrder={() => onOpenOrder(selectedRow)}
              onToggleTimeline={() => toggleTimeline(selectedRow)}
              timelineExpanded={expandedId === selectedRow.id}
            />
          ) : null}
        </div>
      ) : null}

      <div className={`${styles.tableWrap} ${styles.logisticsCompactTableWrap}`}>
        <table className={`${styles.dataTable} ${styles.logisticsCompactTable}`}>
          <thead>
            <tr>
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.blNoColumn}>提单号 / B/L No.</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th>Master B/L</th>
              <th>船公司</th>
              <th>船名航次</th>
              <th>起运港</th>
              <th>目的港</th>
              <th>ETA</th>
              <th>当前状态</th>
              <th>最新节点</th>
              <th>最后同步</th>
              <th>柜号数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={14}><div className={styles.emptyState}>控制塔数据加载中...</div></td></tr>
            ) : rows.length ? rows.map((row) => (
              <Fragment key={row.id}>
                <tr className={getBusinessEntityRowClass(row, styles, styles.clickableRow)}>
                  <td className={styles.orderNoColumn}><strong>{row.orderNo || "-"}</strong></td>
                  <td className={styles.blNoColumn}>{row.blNo || row.billOfLadingNo || row.masterBlNo || "-"}</td>
                  <td className={styles.customerColumn} title={row.customerName || row.customerShortName || ""}>{row.customerShortName || "-"}</td>
                  <td>{row.masterBlNo || row.bookingNumber || "-"}</td>
                  <td>{shipsgoCarrierText(row)}</td>
                  <td>{shipsgoVesselVoyage(row)}</td>
                  <td>{shipsgoPortText(row.originPortName || row.originName, row.originPortCode)}</td>
                  <td>{shipsgoPortText(row.destinationPortName || row.destinationName, row.destinationPortCode)}</td>
                  <td>{row.eta || "暂无 ETA"}</td>
                  <td>
                    <div className={styles.controlTowerStatusStack}>
                      <span className={`${styles.statusPill} ${controlTowerStatusClass(row)}`}>{controlTowerStatusText(row)}</span>
                      {(row.alertLabels || []).map((label) => <span className={controlTowerAlertClass(label)} key={label}>{label}</span>)}
                    </div>
                  </td>
                  <td title={row.latestNodeDescription || ""}>{row.latestNodeDescription || "接口暂未返回运输节点"}</td>
                  <td>{row.lastSyncTime || row.lastSyncedAt ? formatDateTime(row.lastSyncTime || row.lastSyncedAt) : "暂无同步记录"}</td>
                  <td>{row.containerCount || row.containerNumbers?.length || 0}</td>
                  <td>
                    <div className={styles.controlTowerRowActions}>
                      {features.manualSyncEnabled && canManage ? (
                        <button className={styles.primaryButtonCompact} type="button" disabled={Boolean(syncingId)} onClick={() => void syncTracking(row)}>
                          {syncingId === row.id ? "同步中..." : syncingId ? "其他同步进行中" : "同步最新状态"}
                        </button>
                      ) : null}
                      <button className={styles.secondaryButton} type="button" onClick={() => toggleTimeline(row)}>
                        {expandedId === row.id ? "收起节点" : "查看运输节点"}
                      </button>
                      <ShipsgoMapAction features={features} trackingId={row.id} mapUrl={row.mapUrl} />
                      <button className={styles.secondaryButton} type="button" disabled={Boolean(syncingId)} onClick={() => onOpenOrder(row)}>跳转物流详情</button>
                    </div>
                  </td>
                </tr>
                {expandedId === row.id ? (
                  <tr className={styles.detailRow} key={`${row.id}-timeline`}>
                    <td colSpan={14}>
                      <ControlTowerTimeline row={row} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )) : (
              <tr><td colSpan={14}><div className={styles.emptyState}>暂无符合条件的海运跟踪</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
