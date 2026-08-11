import { useEffect, useState } from "react";
import styles from "../../WorkspaceShell.module.css";
import {
  type DomesticLogisticsRow,
  type ShipsgoFeatureFlags,
  type ShipsgoTrackingRow,
} from "./model";
import { ShipsgoTrackingCard } from "./order-tracking-card";
import {
  defaultShipsgoMasterBl,
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
  onCreate: (payload?: { carrierScac?: string; portCode?: string }) => Promise<void>;
  onSync: (trackingId: string) => Promise<ShipsgoTrackingRow>;
  onRecover: () => Promise<void>;
  onDelete: (tracking: ShipsgoTrackingRow) => void;
}) {
  const trackings = row.shipsgoTrackings || [];
  const hasTracking = trackings.length > 0;
  const [carrierScac, setCarrierScac] = useState("");
  const [portCode, setPortCode] = useState("");
  const [showCarrierInput, setShowCarrierInput] = useState(false);
  const [createError, setCreateError] = useState("");
  const [expandedTimelineId, setExpandedTimelineId] = useState("");
  const [timelineLoadingId, setTimelineLoadingId] = useState("");
  const [timelineErrors, setTimelineErrors] = useState<Record<string, string>>({});
  const createBusy = busyKey === `${row.id}:shipsgo:create`;
  const recoverBusy = busyKey === `${row.id}:shipsgo:recover`;
  const masterBlNo = defaultShipsgoMasterBl(row);
  const localContainerNo = (row.domesticLogisticsInfo?.transportItems || []).map((item) => String(item.containerNo || "").trim()).find(Boolean) || "";
  const missingTrackingTarget = !masterBlNo && !localContainerNo;
  const canCreate = canManage && Boolean(features.oceanTrackingEnabled);
  const activeProviderLabel = "飞驼可视";

  function trackingProviderLabel() {
    return "飞驼可视";
  }

  useEffect(() => {
    setCarrierScac("");
    setPortCode("");
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
    if (missingTrackingTarget) {
      setCreateError("请先在物流信息中录入提单号或柜号后再开始追踪");
      return;
    }
    try {
      await onCreate({ carrierScac: showCarrierInput ? carrierScac : "", portCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : `创建${activeProviderLabel}跟踪失败`;
      setCreateError(message);
      if (/船公司|SCAC|carrier/i.test(message)) setShowCarrierInput(true);
    }
  }

  function shipsgoTimelineEvents(tracking: ShipsgoTrackingRow) {
    return Array.isArray(tracking.timeline) ? tracking.timeline : [];
  }

  function trackingNeedsRefresh(tracking: ShipsgoTrackingRow) {
    return /SUBSCRIBED|NOT_SYNCED|PENDING/.test(String(tracking.syncStatus || "").toUpperCase());
  }

  async function toggleTimeline(tracking: ShipsgoTrackingRow) {
    setTimelineErrors((current) => ({ ...current, [tracking.id]: "" }));
    if (expandedTimelineId === tracking.id) {
      setExpandedTimelineId("");
      return;
    }
    setExpandedTimelineId(tracking.id);
    if (shipsgoTimelineEvents(tracking).length && !trackingNeedsRefresh(tracking)) return;
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
      const message = error instanceof Error ? error.message : `同步${trackingProviderLabel()}跟踪失败`;
      console.error("读取运输状态失败", error);
      setTimelineErrors((current) => ({
        ...current,
        [tracking.id]: `读取运输状态失败：${message}`,
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
      const message = error instanceof Error ? error.message : `同步${trackingProviderLabel()}跟踪失败`;
      console.error("同步运输状态失败", error);
      if (expandedTimelineId === tracking.id) {
        setTimelineErrors((current) => ({
          ...current,
          [tracking.id]: `读取运输状态失败：${message}`,
        }));
      }
    }
  }

  return (
    <section className={styles.documentGroupCard}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>{activeProviderLabel}物流跟踪</strong>
        </div>
      </div>
      {trackings.length ? (
        <div className={styles.shipsgoTrackingList}>
          {trackings.map((tracking) => (
            <ShipsgoTrackingCard
              key={tracking.id}
              tracking={tracking}
              features={features}
              canManage={canManage}
              canDelete={canDelete}
              busyKey={busyKey}
              recoverBusy={recoverBusy}
              expanded={expandedTimelineId === tracking.id}
              loadingTimeline={timelineLoadingId === tracking.id}
              error={timelineErrors[tracking.id] || ""}
              onSync={() => { void syncTrackingAndTimeline(tracking); }}
              onToggleTimeline={() => { void toggleTimeline(tracking); }}
              onRecover={() => { void onRecover(); }}
              onDelete={() => onDelete(tracking)}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>暂未创建{activeProviderLabel}跟踪</div>
      )}
      {canCreate && !hasTracking ? (
        <div className={styles.reportFilterGrid} onClick={(event) => event.stopPropagation()}>
          <label>
            提单号 / 柜号
            <strong>{masterBlNo || localContainerNo || "请先在物流信息中录入提单号或柜号后再开始追踪"}</strong>
          </label>
          {showCarrierInput ? (
            <label>
              船公司代码（仅识别失败时填写）
              <input value={carrierScac} onChange={(event) => updateCarrierScac(event.target.value)} placeholder="例如 MAEU / COSCO / MSC" />
            </label>
          ) : null}
          <label>
            中国起运港代码（港区跟踪）
            <input
              value={portCode}
              onChange={(event) => setPortCode(event.target.value.toUpperCase())}
              placeholder="例如 CNSHA；已设后台默认值可留空"
              maxLength={16}
            />
          </label>
          <span className={styles.infoStrip}>点击后将分别查询海运、中国港区和中国海关；海运不支持该船公司时，港区和海关仍会继续。</span>
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
              disabled={createBusy || recoverBusy || missingTrackingTarget}
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
              {recoverBusy ? "同步中..." : `从${activeProviderLabel}同步已有跟踪`}
            </button>
          </label>
        </div>
      ) : null}
    </section>
  );
}
