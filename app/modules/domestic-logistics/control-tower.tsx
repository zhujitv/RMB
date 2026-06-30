import { Fragment, useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import {
  formatShipsgoPortForLocale,
  formatShipsgoStatusForLocale,
} from "../../../lib/shipsgo-display";
import {
  EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS,
  EMPTY_SHIPSGO_CONTROL_TOWER_STATS,
  type ShipsgoControlTowerFilters,
  type ShipsgoControlTowerResponse,
  type ShipsgoControlTowerRow,
  type ShipsgoFeatureFlags,
  type ShipsgoTrackingRow,
} from "./model";
import {
  shipsgoCarrierText,
  shipsgoContainerTags,
  shipsgoPortText,
  shipsgoValue,
  shipsgoVesselVoyage,
  shipsgoTrackingStatusText,
} from "./shipsgo-format";

export function ShipsgoControlTowerView({
  features,
  canManage,
  initialFullScreen = false,
  onOpenOrder,
}: {
  features: ShipsgoFeatureFlags;
  canManage: boolean;
  initialFullScreen?: boolean;
  onOpenOrder: (row: ShipsgoControlTowerRow) => void;
}) {
  const [rows, setRows] = useState<ShipsgoControlTowerRow[]>([]);
  const [stats, setStats] = useState(EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
  const [filters, setFilters] = useState<ShipsgoControlTowerFilters>(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  const [submittedFilters, setSubmittedFilters] = useState<ShipsgoControlTowerFilters>(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [syncingId, setSyncingId] = useState("");
  const [fullScreen, setFullScreen] = useState(initialFullScreen);
  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);

  function setFilterValue<K extends keyof ShipsgoControlTowerFilters>(key: K, value: ShipsgoControlTowerFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    if (error) setError("");
  }

  async function loadControlTower(nextFilters = submittedFilters, quiet = false) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = controlTowerSearchParams(nextFilters);
      const result = await apiJson<ShipsgoControlTowerResponse>(`/api/shipsgo/ocean-trackings/control-tower?${params}`);
      if (result.success === false) throw new Error(result.message || "读取运输监控失败");
      setRows(Array.isArray(result.rows) ? result.rows : []);
      setStats(result.stats || EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
      setUpdatedAt(result.updatedAt || new Date().toISOString());
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "读取运输监控失败";
      console.error("读取运输监控失败", loadError);
      setError(message);
      if (!quiet) {
        setRows([]);
        setStats(EMPTY_SHIPSGO_CONTROL_TOWER_STATS);
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    void loadControlTower(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  }, []);

  useEffect(() => {
    if (!fullScreen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullScreen]);

  useEffect(() => {
    if (!fullScreen) return undefined;
    const timer = window.setInterval(() => {
      void loadControlTower(submittedFilters, true);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [fullScreen, submittedFilters]);

  function submitFilters() {
    setSubmittedFilters(filters);
    setExpandedId("");
    setSelectedId("");
    setNotice("");
    void loadControlTower(filters);
  }

  function resetFilters() {
    setFilters(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
    setSubmittedFilters(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
    setExpandedId("");
    setSelectedId("");
    setNotice("");
    void loadControlTower(EMPTY_SHIPSGO_CONTROL_TOWER_FILTERS);
  }

  async function syncTracking(row: ShipsgoControlTowerRow) {
    if (!features.manualSyncEnabled || !canManage) return;
    setSyncingId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string }>(`/api/shipsgo/ocean-trackings/${encodeURIComponent(row.id)}/sync`, {
        method: "POST",
      });
      if (result.success === false) throw new Error(result.message || "同步大掌櫃跟踪失败");
      await loadControlTower(submittedFilters, true);
      setNotice(result.message || "大掌櫃状态已同步");
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "同步大掌櫃跟踪失败";
      console.error("同步大掌櫃跟踪失败", syncError);
      setError(message);
    } finally {
      setSyncingId("");
    }
  }

  function toggleTimeline(row: ShipsgoControlTowerRow) {
    setExpandedId((current) => current === row.id ? "" : row.id);
  }

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
        <ControlTowerStatCard label="即将到港" value={stats.soonArrivingCount} tone="orange" />
        <ControlTowerStatCard label="ETA 已过期" value={stats.etaOverdueCount} tone="red" />
        <ControlTowerStatCard label="同步失败" value={stats.syncFailedCount} tone="rose" />
        <ControlTowerStatCard label="今日已同步" value={stats.syncedTodayCount} tone="green" />
      </div>

      {!fullScreen ? (
        <div className={styles.controlTowerFilters}>
          <input value={filters.customer} onChange={(event) => setFilterValue("customer", event.target.value)} placeholder="客户简称" />
          <input value={filters.orderNo} onChange={(event) => setFilterValue("orderNo", event.target.value)} placeholder="订单号" />
          <input value={filters.masterBlNo} onChange={(event) => setFilterValue("masterBlNo", event.target.value)} placeholder="Master B/L" />
          <input value={filters.carrier} onChange={(event) => setFilterValue("carrier", event.target.value)} placeholder="船公司" />
          <input value={filters.origin} onChange={(event) => setFilterValue("origin", event.target.value)} placeholder="起运港" />
          <input value={filters.destination} onChange={(event) => setFilterValue("destination", event.target.value)} placeholder="目的港" />
          <select value={filters.status} onChange={(event) => setFilterValue("status", event.target.value)}>
            <option value="">全部状态</option>
            <option value="航行中">航行中</option>
            <option value="已离港">已离港</option>
            <option value="已到港">已到港</option>
            <option value="待更新">待更新</option>
            <option value="同步失败">同步失败</option>
          </select>
          <input type="date" value={filters.etaStart} onChange={(event) => setFilterValue("etaStart", event.target.value)} aria-label="ETA 开始日期" />
          <input type="date" value={filters.etaEnd} onChange={(event) => setFilterValue("etaEnd", event.target.value)} aria-label="ETA 结束日期" />
          <select value={filters.overdue} onChange={(event) => setFilterValue("overdue", event.target.value)}>
            <option value="">是否逾期</option>
            <option value="true">ETA 已过期</option>
            <option value="false">未逾期</option>
          </select>
          <select value={filters.syncFailed} onChange={(event) => setFilterValue("syncFailed", event.target.value)}>
            <option value="">同步状态</option>
            <option value="true">同步失败</option>
            <option value="false">同步正常</option>
          </select>
          <select value={filters.includeCompleted ? "true" : "false"} onChange={(event) => setFilterValue("includeCompleted", event.target.value === "true")}>
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
              syncing={syncingId === selectedRow.id}
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
                <tr className={styles.clickableRow}>
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
                  <td title={row.latestNodeDescription || ""}>{row.latestNodeDescription || "大掌櫃暂未返回运输节点"}</td>
                  <td>{row.lastSyncTime || row.lastSyncedAt ? formatDateTime(row.lastSyncTime || row.lastSyncedAt) : "暂无同步记录"}</td>
                  <td>{row.containerCount || row.containerNumbers?.length || 0}</td>
                  <td>
                    <div className={styles.controlTowerRowActions}>
                      {features.manualSyncEnabled && canManage ? (
                        <button className={styles.primaryButtonCompact} type="button" disabled={syncingId === row.id} onClick={() => void syncTracking(row)}>
                          {syncingId === row.id ? "同步中..." : "同步最新状态"}
                        </button>
                      ) : null}
                      <button className={styles.secondaryButton} type="button" onClick={() => toggleTimeline(row)}>
                        {expandedId === row.id ? "收起节点" : "查看运输节点"}
                      </button>
                      <ShipsgoMapAction features={features} trackingId={row.id} mapUrl={row.mapUrl} />
                      <button className={styles.secondaryButton} type="button" onClick={() => onOpenOrder(row)}>跳转物流详情</button>
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

function ControlTowerStatCard({ label, value, tone }: { label: string; value: number; tone: "blue" | "orange" | "red" | "rose" | "green" }) {
  return (
    <div className={`${styles.controlTowerStatCard} ${controlTowerStatToneClass(tone)}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function controlTowerStatToneClass(tone: "blue" | "orange" | "red" | "rose" | "green") {
  if (tone === "orange") return styles.controlTowerStatOrange;
  if (tone === "red") return styles.controlTowerStatRed;
  if (tone === "rose") return styles.controlTowerStatRose;
  if (tone === "green") return styles.controlTowerStatGreen;
  return styles.controlTowerStatBlue;
}

function controlTowerSearchParams(filters: ShipsgoControlTowerFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (typeof value === "boolean") {
      if (value) params.set(key, "true");
      return;
    }
    if (value.trim()) params.set(key, value.trim());
  });
  return params.toString();
}

function controlTowerStatusText(row: ShipsgoControlTowerRow) {
  if (row.isSyncFailed) return "同步失败";
  if (row.isEtaOverdue) return "ETA 已过期";
  if (row.isSoonArriving) return "即将到港";
  return shipsgoTrackingStatusText(row);
}

function controlTowerStatusClass(row: ShipsgoControlTowerRow) {
  if (row.isSyncFailed) return styles.statusDanger;
  if (row.isEtaOverdue) return styles.statusDanger;
  if (row.isSoonArriving) return styles.statusWarning;
  if (row.isCompleted) return styles.statusSuccess;
  return styles.statusInfo;
}

function controlTowerNodeClass(row: ShipsgoControlTowerRow) {
  if (row.isSyncFailed) return styles.controlTowerNodeFailed;
  if (row.isEtaOverdue) return styles.controlTowerNodeOverdue;
  if (row.isSoonArriving) return styles.controlTowerNodeSoon;
  if (row.isCompleted) return styles.controlTowerNodeDone;
  return styles.controlTowerNodeNormal;
}

function controlTowerAlertClass(label: string) {
  if (label.includes("失败") || label.includes("过期")) return styles.controlTowerAlertDanger;
  if (label.includes("即将")) return styles.controlTowerAlertWarning;
  return styles.controlTowerAlertMuted;
}

function controlTowerTimelineEvents(row: ShipsgoTrackingRow) {
  return Array.isArray(row.timeline) ? row.timeline : [];
}

function ControlTowerTimeline({ row }: { row: ShipsgoControlTowerRow }) {
  const events = controlTowerTimelineEvents(row);
  return (
    <div className={styles.shipsgoTimelinePanel}>
      <strong>运输节点时间轴</strong>
      {events.length ? (
        <div className={styles.shipsgoTimelineList}>
          {events.map((event, index) => (
            <div className={styles.shipsgoTimelineItem} key={`${event.time || "no-time"}-${event.location || "no-location"}-${index}`}>
              <div className={styles.shipsgoTimelineDot} aria-hidden="true" />
              <div className={styles.shipsgoTimelineContent}>
                <div className={styles.shipsgoTimelineHeader}>
                  <strong>{event.time ? formatDateTime(event.time) : "时间未返回"}</strong>
                  <span>数据来源：{event.source || "大掌櫃"}</span>
                </div>
                <span>地点：{formatShipsgoPortForLocale(event.location, "", "zh-CN") || shipsgoValue(event.location)}</span>
                <span>状态：{formatShipsgoStatusForLocale(event.description, "zh-CN") || shipsgoValue(event.description)}</span>
                <span>船名/航次：{[event.vesselName, event.voyage].filter(Boolean).join(" / ") || "未返回"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.shipsgoTimelineState}>大掌櫃暂未返回运输节点。</div>
      )}
    </div>
  );
}

function ControlTowerTooltip({ row }: { row: ShipsgoControlTowerRow }) {
  return (
    <div className={styles.controlTowerTooltip} role="tooltip">
      <strong>{row.orderNo || "-"}</strong>
      <span>客户简称：{row.customerShortName || "-"}</span>
      <span>Master B/L：{row.masterBlNo || row.bookingNumber || "-"}</span>
      <span>集装箱号：{shipsgoContainerTags(row).join(" / ") || "-"}</span>
      <span>船公司：{shipsgoCarrierText(row)}</span>
      <span>船名航次：{shipsgoVesselVoyage(row)}</span>
      <span>当前状态：{controlTowerStatusText(row)}</span>
      <span>当前节点：{row.latestNodeDescription || "大掌櫃暂未返回运输节点"}</span>
      <span>节点时间：{row.latestNodeTime ? formatDateTime(row.latestNodeTime) : "未返回"}</span>
      <span>起运港：{shipsgoPortText(row.originPortName || row.originName, row.originPortCode)}</span>
      <span>目的港：{shipsgoPortText(row.destinationPortName || row.destinationName, row.destinationPortCode)}</span>
      <span>ETA：{row.eta || "暂无 ETA"}</span>
      <span>最后同步：{row.lastSyncTime || row.lastSyncedAt ? formatDateTime(row.lastSyncTime || row.lastSyncedAt) : "暂无同步记录"}</span>
    </div>
  );
}

function ControlTowerDetailPanel({
  row,
  canManage,
  features,
  syncing,
  onSync,
  onOpenOrder,
  onToggleTimeline,
  timelineExpanded,
}: {
  row: ShipsgoControlTowerRow;
  canManage: boolean;
  features: ShipsgoFeatureFlags;
  syncing: boolean;
  onSync: () => void;
  onOpenOrder: () => void;
  onToggleTimeline: () => void;
  timelineExpanded: boolean;
}) {
  return (
    <aside className={styles.controlTowerDetailPanel} onClick={(event) => event.stopPropagation()}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{row.orderNo || "-"}</strong>
          <span>{row.masterBlNo || row.bookingNumber || "-"} ｜ {shipsgoTrackingStatusText(row)}</span>
        </div>
      </div>
      <div className={styles.shipsgoContainerTags}>
        {shipsgoContainerTags(row).length ? shipsgoContainerTags(row).map((containerNo) => (
          <span key={containerNo}>{containerNo}</span>
        )) : <span>未返回</span>}
      </div>
      <ControlTowerTimeline row={row} />
      <div className={styles.controlTowerRowActions}>
        {features.manualSyncEnabled && canManage ? (
          <button className={styles.primaryButtonCompact} type="button" disabled={syncing} onClick={onSync}>{syncing ? "同步中..." : "同步最新状态"}</button>
        ) : null}
        <button className={styles.secondaryButton} type="button" onClick={onToggleTimeline}>{timelineExpanded ? "收起运输节点" : "展开运输节点"}</button>
        <ShipsgoMapAction features={features} trackingId={row.id} mapUrl={row.mapUrl} />
        <button className={styles.secondaryButton} type="button" onClick={onOpenOrder}>跳转物流详情</button>
      </div>
    </aside>
  );
}

export function ShipsgoMapAction({
  features,
  trackingId,
  mapUrl,
}: {
  features: ShipsgoFeatureFlags;
  trackingId?: string;
  mapUrl?: string;
}) {
  if (!features.liveMapEnabled) return null;
  const cleanTrackingId = String(trackingId || "").trim();
  const cleanMapUrl = String(mapUrl || "").trim();
  const href = cleanMapUrl || (cleanTrackingId ? `/tracking-map?trackingId=${encodeURIComponent(cleanTrackingId)}` : "");
  if (!href) return null;
  return (
    <a
      className={styles.secondaryButton}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
    >
      查看地图
    </a>
  );
}
