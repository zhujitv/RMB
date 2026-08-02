import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import {
  formatShipsgoPortForLocale,
  formatShipsgoStatusForLocale,
} from "../../../lib/shipsgo-display";
import type { ShipsgoControlTowerFilters, ShipsgoControlTowerRow, ShipsgoFeatureFlags, ShipsgoTrackingRow } from "./model";
import {
  shipsgoCarrierText,
  shipsgoContainerTags,
  shipsgoPortText,
  shipsgoValue,
  shipsgoVesselVoyage,
  shipsgoTrackingStatusText,
} from "./shipsgo-format";

export function ControlTowerStatCard({ label, value, tone }: { label: string; value: number; tone: "blue" | "orange" | "red" | "rose" | "green" }) {
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

export function controlTowerSearchParams(filters: ShipsgoControlTowerFilters) {
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

export function controlTowerStatusText(row: ShipsgoControlTowerRow) {
  if (row.hasDumpingWarning) return "甩柜预警";
  if (row.isSyncFailed) return "同步失败";
  if (row.isEtaOverdue) return "ETA 已过期";
  if (row.isSoonArriving) return "即将到港";
  return shipsgoTrackingStatusText(row);
}

export function controlTowerStatusClass(row: ShipsgoControlTowerRow) {
  if (row.hasDumpingWarning) return styles.statusDanger;
  if (row.isSyncFailed) return styles.statusDanger;
  if (row.isEtaOverdue) return styles.statusDanger;
  if (row.isSoonArriving) return styles.statusWarning;
  if (row.isCompleted) return styles.statusSuccess;
  return styles.statusInfo;
}

export function controlTowerNodeClass(row: ShipsgoControlTowerRow) {
  if (row.hasDumpingWarning) return styles.controlTowerNodeAlert;
  if (row.isSyncFailed) return styles.controlTowerNodeFailed;
  if (row.isEtaOverdue) return styles.controlTowerNodeOverdue;
  if (row.isSoonArriving) return styles.controlTowerNodeSoon;
  if (row.isCompleted) return styles.controlTowerNodeDone;
  return styles.controlTowerNodeNormal;
}

export function controlTowerAlertClass(label: string) {
  if (label.includes("甩柜") || label.includes("失败") || label.includes("过期")) return styles.controlTowerAlertDanger;
  if (label.includes("即将")) return styles.controlTowerAlertWarning;
  return styles.controlTowerAlertMuted;
}

function controlTowerTimelineEvents(row: ShipsgoTrackingRow) {
  return Array.isArray(row.timeline) ? row.timeline : [];
}

function trackingProviderLabel() {
  return "飞驼可视";
}

export function FreightowerDumpingAlertBanner({ tracking }: { tracking: ShipsgoTrackingRow }) {
  const alerts = (tracking.alerts || []).filter((alert) => alert.isDumping && alert.active !== false);
  if (!alerts.length) return null;
  return (
    <div className={styles.shipsgoAlertBanner} role="alert" aria-live="assertive">
      <div className={styles.shipsgoAlertBannerHeader}>
        <strong>甩柜预警</strong>
        <span>{alerts.length} 条</span>
      </div>
      <div className={styles.shipsgoAlertList}>
        {alerts.slice(0, 3).map((alert, index) => (
          <div key={`${alert.code || "DUMP"}-${alert.time || "no-time"}-${alert.containerNo || index}`}>
            <strong>{alert.title || "甩柜预警"}</strong>
            <span>{alert.description || "飞驼检测到起运港甩柜风险，请及时确认后续船名航次。"}</span>
            <small>
              {[alert.containerNo, alert.location, alert.time ? formatDateTime(alert.time) : ""].filter(Boolean).join(" ｜ ") || "详细信息待飞驼返回"}
            </small>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ControlTowerTimeline({ row }: { row: ShipsgoControlTowerRow }) {
  const events = controlTowerTimelineEvents(row);
  const providerLabel = trackingProviderLabel();
  return (
    <div className={styles.shipsgoTimelinePanel}>
      <strong>运输节点时间轴</strong>
      {events.length ? (
        <div className={styles.shipsgoTimelineList}>
          {events.map((event, index) => (
            <div className={styles.shipsgoTimelineItem} key={`${event.time || "no-time"}-${event.location || "no-location"}-${index}`}>
              <div className={`${styles.shipsgoTimelineDot} ${event.isWarning ? styles.shipsgoTimelineWarningDot : ""}`} aria-hidden="true" />
              <div className={`${styles.shipsgoTimelineContent} ${event.isWarning ? styles.shipsgoTimelineWarningContent : ""}`}>
                <div className={styles.shipsgoTimelineHeader}>
                  <strong>{event.time ? formatDateTime(event.time) : "时间未返回"}</strong>
	                  <span>数据来源：{event.source || providerLabel}</span>
                </div>
                <span>地点：{formatShipsgoPortForLocale(event.location, "", "zh-CN") || shipsgoValue(event.location)}</span>
                <span>状态：{formatShipsgoStatusForLocale(event.description, "zh-CN") || shipsgoValue(event.description)}</span>
                <span>船名/航次：{[event.vesselName, event.voyage].filter(Boolean).join(" / ") || "未返回"}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
	        <div className={styles.shipsgoTimelineState}>{providerLabel}暂未返回运输节点。</div>
      )}
    </div>
  );
}

export function ControlTowerTooltip({ row }: { row: ShipsgoControlTowerRow }) {
  return (
    <div className={styles.controlTowerTooltip} role="tooltip">
      <strong>{row.orderNo || "-"}</strong>
      <span>客户简称：{row.customerShortName || "-"}</span>
      <span>Master B/L：{row.masterBlNo || row.bookingNumber || "-"}</span>
      <span>集装箱号：{shipsgoContainerTags(row).join(" / ") || "-"}</span>
      <span>船公司：{shipsgoCarrierText(row)}</span>
      <span>船名航次：{shipsgoVesselVoyage(row)}</span>
      <span>当前状态：{controlTowerStatusText(row)}</span>
      {row.dumpingWarning ? <span>甩柜预警：{row.dumpingWarning}</span> : null}
      <span>当前节点：{row.latestNodeDescription || `${trackingProviderLabel()}暂未返回运输节点`}</span>
      <span>节点时间：{row.latestNodeTime ? formatDateTime(row.latestNodeTime) : "未返回"}</span>
      <span>起运港：{shipsgoPortText(row.originPortName || row.originName, row.originPortCode)}</span>
      <span>目的港：{shipsgoPortText(row.destinationPortName || row.destinationName, row.destinationPortCode)}</span>
      <span>ETA：{row.eta || "暂无 ETA"}</span>
      <span>最后同步：{row.lastSyncTime || row.lastSyncedAt ? formatDateTime(row.lastSyncTime || row.lastSyncedAt) : "暂无同步记录"}</span>
    </div>
  );
}

export function ControlTowerDetailPanel({
  row,
  canManage,
  features,
  syncing,
  navigationDisabled,
  onSync,
  onOpenOrder,
  onToggleTimeline,
  timelineExpanded,
}: {
  row: ShipsgoControlTowerRow;
  canManage: boolean;
  features: ShipsgoFeatureFlags;
  syncing: boolean;
  navigationDisabled: boolean;
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
      <FreightowerDumpingAlertBanner tracking={row} />
      <ControlTowerTimeline row={row} />
      <div className={styles.controlTowerRowActions}>
        {features.manualSyncEnabled && canManage ? (
          <button className={styles.primaryButtonCompact} type="button" disabled={syncing} onClick={onSync}>{syncing ? "同步中..." : "同步最新状态"}</button>
        ) : null}
        <button className={styles.secondaryButton} type="button" onClick={onToggleTimeline}>{timelineExpanded ? "收起运输节点" : "展开运输节点"}</button>
        <ShipsgoMapAction features={features} trackingId={row.id} mapUrl={row.mapUrl} />
        <button className={styles.secondaryButton} type="button" disabled={navigationDisabled} onClick={onOpenOrder}>跳转物流详情</button>
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
