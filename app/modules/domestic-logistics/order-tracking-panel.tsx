import { useEffect, useState } from "react";
import { formatDateTime } from "../../formatters";
import styles from "../../WorkspaceShell.module.css";
import {
  formatShipsgoPortForLocale,
  formatShipsgoStatusForLocale,
} from "../../../lib/shipsgo-display";
import { ShipsgoMapAction } from "./control-tower";
import {
  type DomesticLogisticsRow,
  type ShipsgoFeatureFlags,
  type ShipsgoTrackingRow,
} from "./model";
import {
  defaultShipsgoMasterBl,
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

export function ShipsgoOrderTrackingPanel({
  row,
  features,
  canManage,
  canDelete,
  busyKey,
  onCreate,
  onSync,
  onRecover,
  onDelete,
}: {
  row: DomesticLogisticsRow;
  features: ShipsgoFeatureFlags;
  canManage: boolean;
  canDelete: boolean;
  busyKey: string;
  onCreate: (payload?: { carrierScac?: string }) => Promise<void>;
  onSync: (trackingId: string) => Promise<ShipsgoTrackingRow>;
  onRecover: () => Promise<void>;
  onDelete: (tracking: ShipsgoTrackingRow) => void;
}) {
  const trackings = row.shipsgoTrackings || [];
  const hasTracking = trackings.length > 0;
  const [carrierScac, setCarrierScac] = useState("");
  const [showCarrierInput, setShowCarrierInput] = useState(false);
  const [createError, setCreateError] = useState("");
  const [expandedTimelineId, setExpandedTimelineId] = useState("");
  const [timelineLoadingId, setTimelineLoadingId] = useState("");
  const [timelineErrors, setTimelineErrors] = useState<Record<string, string>>({});
  const createBusy = busyKey === `${row.id}:shipsgo:create`;
  const recoverBusy = busyKey === `${row.id}:shipsgo:recover`;
  const masterBlNo = defaultShipsgoMasterBl(row);
  const missingMasterBlNo = !masterBlNo;
  const canCreate = canManage && Boolean(features.oceanTrackingEnabled);

  useEffect(() => {
    setCarrierScac("");
    setShowCarrierInput(false);
    setCreateError("");
    setExpandedTimelineId("");
    setTimelineLoadingId("");
    setTimelineErrors({});
  }, [row.id, row.blNo, row.billOfLadingNo, row.domesticLogisticsInfo?.id]);

  function updateCarrierScac(value: string) {
    setCarrierScac(value.toUpperCase());
    if (createError) setCreateError("");
  }

  async function submitCreateTracking() {
    setCreateError("");
    if (!masterBlNo) {
      setCreateError("请先在物流信息中录入提单号后再开始追踪");
      return;
    }
    try {
      await onCreate({ carrierScac: showCarrierInput ? carrierScac : "" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建大掌櫃跟踪失败";
      setCreateError(message);
      if (/船公司|SCAC|carrier/i.test(message)) setShowCarrierInput(true);
    }
  }

  function shipsgoTimelineEvents(tracking: ShipsgoTrackingRow) {
    return Array.isArray(tracking.timeline) ? tracking.timeline : [];
  }

  async function toggleTimeline(tracking: ShipsgoTrackingRow) {
    setTimelineErrors((current) => ({ ...current, [tracking.id]: "" }));
    if (expandedTimelineId === tracking.id) {
      setExpandedTimelineId("");
      return;
    }
    setExpandedTimelineId(tracking.id);
    if (!tracking.shipsgoShipmentId) {
      setTimelineErrors((current) => ({
        ...current,
        [tracking.id]: "本地未保存大掌櫃跟踪ID，请先从大掌櫃同步已有跟踪。",
      }));
      return;
    }
    if (shipsgoTimelineEvents(tracking).length) return;
    if (!canManage) {
      setTimelineErrors((current) => ({
        ...current,
        [tracking.id]: "暂无已同步运输节点，请联系管理员或业务员同步最新状态。",
      }));
      return;
    }
    setTimelineLoadingId(tracking.id);
    try {
      await onSync(tracking.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步大掌櫃跟踪失败";
      console.error("读取大掌櫃运输状态失败", error);
      setTimelineErrors((current) => ({
        ...current,
        [tracking.id]: `读取大掌櫃运输状态失败：${message}`,
      }));
    } finally {
      setTimelineLoadingId("");
    }
  }

  async function syncTrackingAndTimeline(tracking: ShipsgoTrackingRow) {
    setTimelineErrors((current) => ({ ...current, [tracking.id]: "" }));
    try {
      await onSync(tracking.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步大掌櫃跟踪失败";
      console.error("同步大掌櫃运输状态失败", error);
      if (expandedTimelineId === tracking.id) {
        setTimelineErrors((current) => ({
          ...current,
          [tracking.id]: `读取大掌櫃运输状态失败：${message}`,
        }));
      }
    }
  }

  return (
    <section className={styles.documentGroupCard}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>大掌櫃海运跟踪</strong>
        </div>
      </div>
      {trackings.length ? (
        <div className={styles.shipsgoTrackingList}>
          {trackings.map((tracking) => {
            const syncBusy = busyKey === `${tracking.id}:shipsgo:sync`;
            const containers = shipsgoContainerTags(tracking);
            const etaText = tracking.eta || tracking.predictedDischargeDate || tracking.dateOfDischarge || "";
            const showRecover = canManage && shouldShowShipsgoRecover(tracking);
            const deleteBusy = busyKey === `${tracking.id}:shipsgo:delete`;
            const timelineExpanded = expandedTimelineId === tracking.id;
            const timelineLoading = timelineLoadingId === tracking.id || syncBusy && timelineExpanded && !shipsgoTimelineEvents(tracking).length;
            const timelineError = timelineErrors[tracking.id] || "";
            const timelineEvents = shipsgoTimelineEvents(tracking);
            return (
              <article className={styles.shipsgoTrackingCard} key={tracking.id}>
                <div className={styles.shipsgoTrackingSummary}>
                  <span className={styles.shipsgoStatusBadge}>{shipsgoTrackingStatusText(tracking)}</span>
                  <strong>预计到港 ETA：{shipsgoValue(etaText, "暂无 ETA")}</strong>
                  <span>最后同步时间：{shipsgoSyncTime(tracking)}</span>
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

                {tracking.syncMessage ? <span className={styles.shipsgoSyncMessage}>同步提示：{tracking.syncMessage}</span> : null}
                <div className={styles.shipsgoTrackingActions}>
                  {features.manualSyncEnabled && canManage ? (
                    <button
                      className={styles.primaryButtonCompact}
                      type="button"
                      disabled={syncBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void syncTrackingAndTimeline(tracking);
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
                      void toggleTimeline(tracking);
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
                      {recoverBusy ? "同步中..." : "从大掌櫃同步已有跟踪"}
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      className={styles.dangerButton}
                      type="button"
                      disabled={deleteBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(tracking);
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
                      <div className={styles.shipsgoTimelineState}>正在读取大掌櫃运输状态...</div>
                    ) : timelineError ? (
                      <div className={styles.shipsgoTimelineError} role="alert">{timelineError}</div>
                    ) : timelineEvents.length ? (
                      <div className={styles.shipsgoTimelineList}>
                        {timelineEvents.map((event, index) => (
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
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>暂未创建大掌櫃跟踪</div>
      )}
      {canCreate && !hasTracking ? (
        <div className={styles.reportFilterGrid} onClick={(event) => event.stopPropagation()}>
          <label>
            Master B/L（提单号）
            <strong>{masterBlNo || "请先在物流信息中录入提单号后再开始追踪"}</strong>
          </label>
          {showCarrierInput ? (
            <label>
              船公司 SCAC（仅识别失败时填写）
              <input value={carrierScac} onChange={(event) => updateCarrierScac(event.target.value)} placeholder="例如 MAEU / CMDU" />
            </label>
          ) : null}
          {createError ? (
            <div className={`${styles.inlineError} ${styles.shipsgoCreateError}`} role="alert">
              {createError}
            </div>
          ) : null}
          <label>
            跟踪
            <button
              className={styles.primaryButtonCompact}
              type="button"
              disabled={createBusy || recoverBusy || missingMasterBlNo}
              onClick={(event) => {
                event.stopPropagation();
                void submitCreateTracking();
              }}
            >
              {createBusy ? "创建中..." : "开始追踪"}
            </button>
          </label>
          <label>
            已有跟踪
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={createBusy || recoverBusy}
              onClick={(event) => {
                event.stopPropagation();
                void onRecover();
              }}
            >
              {recoverBusy ? "同步中..." : "从大掌櫃同步已有跟踪"}
            </button>
          </label>
        </div>
      ) : null}
    </section>
  );
}
