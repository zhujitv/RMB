import { formatShipsgoPortForLocale, formatShipsgoStatusForLocale } from "../../../lib/shipsgo-display";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import { ShipsgoMapAction } from "./control-tower";
import { FreightowerDumpingAlertBanner } from "./control-tower-components";
import type { ShipsgoFeatureFlags, ShipsgoTrackingRow } from "./model";
import {
  shipsgoCarrierText,
  shipsgoContainerTags,
  shipsgoPortText,
  shipsgoSyncTime,
  shipsgoTrackingMethodText,
  shipsgoTrackingStatusText,
  shipsgoValue,
  shipsgoVesselVoyage,
  shouldShowShipsgoRecover,
} from "./shipsgo-format";

function trackingProviderLabel() {
  return "飞驼可视";
}

function shipsgoTimelineEvents(tracking: ShipsgoTrackingRow) {
  return Array.isArray(tracking.timeline) ? tracking.timeline : [];
}

function portTrackingLabel(tracking: ShipsgoTrackingRow) {
  const status = String(tracking.portTrackingStatus || "NOT_SUBSCRIBED").toUpperCase();
  if (status === "SYNCED") return `已同步${tracking.portEventCount ? `（${tracking.portEventCount} 个节点）` : ""}`;
  if (status === "SUBSCRIBED") return "已订阅，等待港区节点";
  if (status === "PERMISSION_REQUIRED") return "待开通权限";
  if (status === "WAITING_PORT_CODE") return "等待起运港代码";
  if (status === "SYNC_FAILED") return "同步失败";
  return "待订阅";
}

function customsTrackingLabel(tracking: ShipsgoTrackingRow) {
  const status = String(tracking.customsTrackingStatus || "NOT_QUERIED").toUpperCase();
  if (status === "SYNCED") return `已同步${tracking.customsEventCount ? `（${tracking.customsEventCount} 个节点）` : ""}`;
  if (status === "SUBSCRIBED") return "已查询，等待海关节点";
  if (status === "PERMISSION_REQUIRED") return "待开通权限";
  if (status === "CREDENTIAL_REQUIRED") return "待配置 API Key";
  if (status === "DISABLED") return "未启用";
  if (status === "WAITING_CONTEXT") return "等待提单号或进出口方向";
  if (status === "SYNC_FAILED") return "同步失败";
  return "待查询";
}

export function ShipsgoTrackingCard({
  tracking,
  features,
  canManage,
  canDelete,
  busyKey,
  recoverBusy,
  expanded,
  loadingTimeline,
  error,
  onSync,
  onToggleTimeline,
  onRecover,
  onDelete,
}: {
  tracking: ShipsgoTrackingRow;
  features: ShipsgoFeatureFlags;
  canManage: boolean;
  canDelete: boolean;
  busyKey: string;
  recoverBusy: boolean;
  expanded: boolean;
  loadingTimeline: boolean;
  error: string;
  onSync: () => void;
  onToggleTimeline: () => void;
  onRecover: () => void;
  onDelete: () => void;
}) {

  const syncBusy = busyKey === `${tracking.id}:shipsgo:sync`;
  const containers = shipsgoContainerTags(tracking);
  const etaText = tracking.eta || tracking.predictedDischargeDate || tracking.dateOfDischarge || "";
  const showRecover = canManage && shouldShowShipsgoRecover(tracking);
  const deleteBusy = busyKey === `${tracking.id}:shipsgo:delete`;
  const timelineExpanded = expanded;
  const timelineLoading = loadingTimeline || syncBusy && timelineExpanded && !shipsgoTimelineEvents(tracking).length;
  const timelineError = error || "";
  const timelineEvents = shipsgoTimelineEvents(tracking);
  const providerLabel = trackingProviderLabel();
  return (
    <article className={styles.shipsgoTrackingCard} key={tracking.id}>
      <div className={styles.shipsgoTrackingSummary}>
        <span className={styles.shipsgoStatusBadge}>{shipsgoTrackingStatusText(tracking)}</span>
        <strong>预计到港 ETA：{shipsgoValue(etaText, "暂无 ETA")}</strong>
        <span>{providerLabel} ｜ 最后同步时间：{shipsgoSyncTime(tracking)}</span>
      </div>

      <div className={styles.shipsgoTrackingInfoGrid}>
        <div className={styles.shipsgoInfoColumn}>
          <div className={styles.shipsgoInfoItem}>
            <span>船公司</span>
            <strong>{shipsgoCarrierText(tracking)}</strong>
          </div>
          <div className={styles.shipsgoInfoItem}>
            <span>Master B/L</span>
            <strong>{shipsgoValue(tracking.masterBlNo || tracking.bookingNumber)}</strong>
          </div>
          <div className={styles.shipsgoInfoItem}>
            <span>船名航次</span>
            <strong>{shipsgoVesselVoyage(tracking)}</strong>
          </div>
        </div>
        <div className={styles.shipsgoInfoColumn}>
          <div className={styles.shipsgoInfoItem}>
            <span>起运港</span>
            <strong>{shipsgoPortText(tracking.originPortName || tracking.originName, tracking.originPortCode)}</strong>
          </div>
          <div className={styles.shipsgoInfoItem}>
            <span>目的港</span>
            <strong>{shipsgoPortText(tracking.destinationPortName || tracking.destinationName, tracking.destinationPortCode)}</strong>
          </div>
          <div className={styles.shipsgoInfoItem}>
            <span>跟踪方式</span>
            <strong>{shipsgoTrackingMethodText("Master B/L")}</strong>
          </div>
        </div>
      </div>

      <div className={styles.shipsgoContainerBlock}>
        <span>关联柜号</span>
        <div className={styles.shipsgoContainerTags}>
          {containers.length ? containers.map((containerNo) => (
            <span key={containerNo}>{containerNo}</span>
          )) : <span>未返回</span>}
        </div>
      </div>

      <FreightowerDumpingAlertBanner tracking={tracking} />

      {tracking.syncMessage ? <span className={styles.shipsgoSyncMessage}>同步提示：{tracking.syncMessage}</span> : null}
      <span className={styles.shipsgoSyncMessage}>
        中国港区：{portTrackingLabel(tracking)}
        {tracking.portCode ? ` ｜ 港口 ${tracking.portCode}` : ""}
        {tracking.portLastSyncedAt ? ` ｜ 更新于 ${formatDateTime(tracking.portLastSyncedAt)}` : ""}
        {tracking.portTrackingMessage ? ` ｜ ${tracking.portTrackingMessage}` : ""}
      </span>
      {features.customsTrackingEnabled || Boolean(tracking.customsEventCount) ? (
        <span className={styles.shipsgoSyncMessage}>
          中国海关：{customsTrackingLabel(tracking)}
          {tracking.customsDirection ? ` ｜ ${tracking.customsDirection === "I" ? "进口" : "出口"}` : ""}
          {tracking.customsLastSyncedAt ? ` ｜ 更新于 ${formatDateTime(tracking.customsLastSyncedAt)}` : ""}
          {tracking.customsTrackingMessage ? ` ｜ ${tracking.customsTrackingMessage}` : ""}
        </span>
      ) : null}
      <div className={styles.shipsgoTrackingActions}>
        {features.manualSyncEnabled && canManage ? (
          <button
            className={styles.primaryButtonCompact}
            type="button"
            disabled={syncBusy}
            onClick={(event) => {
              event.stopPropagation();
              onSync();
            }}
          >
            {syncBusy ? "同步中..." : "同步最新状态"}
          </button>
        ) : null}
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleTimeline();
          }}
        >
          {timelineExpanded ? "收起运输状态" : "查看运输状态"}
        </button>
        <ShipsgoMapAction features={features} trackingId={tracking.id} mapUrl={tracking.mapUrl} />
        {showRecover ? (
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={recoverBusy}
            onClick={(event) => {
              event.stopPropagation();
              void onRecover();
            }}
          >
            {recoverBusy ? "同步中..." : "从飞驼可视同步已有跟踪"}
          </button>
        ) : null}
        {canDelete ? (
          <button
            className={styles.dangerButton}
            type="button"
            disabled={deleteBusy}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            {deleteBusy ? "删除中..." : "删除跟踪"}
          </button>
        ) : null}
      </div>
      {timelineExpanded ? (
        <div className={styles.shipsgoTimelinePanel}>
          <strong>运输状态时间轴</strong>
          {timelineLoading ? (
            <div className={styles.shipsgoTimelineState}>正在读取{providerLabel}运输状态...</div>
          ) : timelineError ? (
            <div className={styles.shipsgoTimelineError} role="alert">{timelineError}</div>
          ) : timelineEvents.length ? (
            <div className={styles.shipsgoTimelineList}>
              {timelineEvents.map((event, index) => (
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
      ) : null}
    </article>
  );

}
