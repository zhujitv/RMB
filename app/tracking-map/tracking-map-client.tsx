"use client";

import { useEffect, useState } from "react";
import { formatShipsgoTrackingMethodForLocale } from "../../lib/shipsgo-display";
import {
  clean,
  containers,
  fetchTracking,
  formatDateTime,
  providerLabel,
  shipsgoCarrierText,
  shipsgoPortText,
  shipsgoStatusText,
  vesselVoyageText,
  type ShipsgoTracking,
  type TrackingMapClientProps,
} from "./tracking-map-model";
import styles from "./tracking-map.module.css";

export default function TrackingMapClient({ initialTrackingId, initialBillOfLading }: TrackingMapClientProps) {
  const trackingId = clean(initialTrackingId);
  const billOfLading = clean(initialBillOfLading);
  const [loading, setLoading] = useState(Boolean(trackingId));
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState<ShipsgoTracking | null>(null);

  useEffect(() => {
    if (!trackingId) return;
    let active = true;
    setLoading(true);
    setError("");
    fetchTracking(trackingId)
      .then((data) => {
        if (!active) return;
        setTracking(data.tracking || null);
      })
      .catch((loadError) => {
        if (!active) return;
        console.error("运输地图数据加载失败", loadError);
        setError("当前运输跟踪数据加载失败，请重新同步后再试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [trackingId]);

  useEffect(() => {
    if (!tracking) {
      document.title = "运输地图";
      return;
    }
    const masterBlNo = clean(tracking.masterBlNo || tracking.bookingNumber);
    document.title = masterBlNo ? `${masterBlNo} - ${providerLabel(tracking)}运输地图` : `${providerLabel(tracking)}运输地图`;
  }, [tracking]);

  if (!trackingId) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyPanel}>
          <span>运输地图</span>
          <h1>请选择一条运输跟踪记录</h1>
          {billOfLading ? <p>当前 URL 仅包含提单号 {billOfLading}，请从物流信息或运输监控中点击对应记录的「查看地图」。</p> : null}
        </section>
      </main>
    );
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <section className={styles.emptyPanel}>
          <span>运输地图</span>
          <h1>正在读取运输跟踪数据...</h1>
          <p>系统正在根据 trackingId 自动加载当前订单的运输跟踪记录。</p>
        </section>
      </main>
    );
  }

  if (error || !tracking) {
    return (
      <main className={styles.page}>
        <section className={styles.errorPanel}>
          <span>读取失败</span>
          <h1>当前运输跟踪数据加载失败，请重新同步后再试。</h1>
          {error ? <p>{error}</p> : null}
        </section>
      </main>
    );
  }

  const providerName = providerLabel(tracking);
  const masterBlNo = tracking.masterBlNo || tracking.bookingNumber || "接口未返回";
  const containerNumbers = containers(tracking);
  const originPort = shipsgoPortText(tracking.originPortName || tracking.originName, tracking.originPortCode);
  const destinationPort = shipsgoPortText(tracking.destinationPortName || tracking.destinationName, tracking.destinationPortCode);
  const timeline = tracking.timeline || [];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>{providerName}运输地图</span>
          <h1>{masterBlNo}</h1>
        </div>
        <a className={styles.backLink} href="/?view=domesticLogistics" target="_self">返回物流信息</a>
      </header>

      <section className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span>当前状态</span>
          <strong>{shipsgoStatusText(tracking)}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span>ETA</span>
          <strong>{tracking.eta || "暂无 ETA"}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span>最后同步</span>
          <strong>{formatDateTime(tracking.lastSyncTime || tracking.lastSyncedAt) || "暂无同步记录"}</strong>
        </div>
      </section>

      <section className={styles.detailGrid}>
        <div className={styles.infoPanel}>
          <h2>跟踪信息</h2>
          <div className={styles.infoGrid}>
            <InfoItem label="Master B/L" value={masterBlNo} />
            <InfoItem label="船公司" value={shipsgoCarrierText(tracking)} />
            <InfoItem label="船名航次" value={vesselVoyageText(tracking)} />
            <InfoItem label="起运港" value={originPort} />
            <InfoItem label="目的港" value={destinationPort} />
            <InfoItem label="跟踪方式" value={formatShipsgoTrackingMethodForLocale("Master B/L", "zh-CN")} />
          </div>
          <div className={styles.containerBlock}>
            <span>关联柜号</span>
            <div className={styles.containerTags}>
              {containerNumbers.length ? containerNumbers.map((containerNo) => (
                <span key={containerNo}>{containerNo}</span>
              )) : <span>接口未返回</span>}
            </div>
          </div>
        </div>

        <div className={styles.timelinePanel}>
          <h2>运输节点</h2>
          {timeline.length ? (
            <div className={styles.timelineList}>
              {timeline.slice(0, 6).map((event, index) => (
                <div className={styles.timelineItem} key={`${event.time || index}-${event.description || index}`}>
                  <span className={styles.timelineDot} />
                  <div>
                    <strong>{event.description || `${providerName}节点`}</strong>
                    <span>{formatDateTime(event.time) || "时间未返回"} ｜ {shipsgoPortText(event.location, "")}</span>
                    <span>{event.vesselName || event.voyage ? `${event.vesselName || ""}${event.voyage ? ` / ${event.voyage}` : ""}` : "船名航次未返回"} ｜ 数据来源：{event.source || providerName}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.mutedText}>{providerName}暂未返回运输节点。</p>
          )}
        </div>
      </section>

      <section className={styles.mapPanel}>
        <div className={styles.mapHeader}>
          <div>
            <span>{providerName}原始地图</span>
            <h2>船舶位置与航线轨迹</h2>
          </div>
        </div>
        {tracking.mapUrl ? (
          <div className={styles.mapLinkPanel}>
            <strong>{masterBlNo}</strong>
            <span>系统已读取当前跟踪记录。点击下方按钮将按{providerName}返回的原始地图链接打开。</span>
            <a className={styles.primaryMapLink} href={tracking.mapUrl} target="_blank" rel="noreferrer">
              打开{providerName}原始地图
            </a>
          </div>
        ) : (
          <div className={styles.mapFallback}>
            {providerName}暂未返回原始地图链接，请先同步最新状态后再试。
          </div>
        )}
      </section>
    </main>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.infoItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
