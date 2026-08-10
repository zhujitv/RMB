"use client";

import { useEffect, useState } from "react";
import styles from "./tracking-map.module.css";

export default function MapSessionBootstrap({ trackingId }: { trackingId: string }) {
  const [error, setError] = useState("");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("token") || "";
    const cleanUrl = new URL(window.location.href);
    cleanUrl.hash = "";
    cleanUrl.searchParams.delete("exchange");
    window.history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}`);
    if (!token || !trackingId) {
      setError("地图登录信息无效，请返回小程序物流详情后重新打开。");
      return;
    }
    const controller = new AbortController();
    fetch("/api/wechat-mini/map-session", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ trackingId }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || data.message || "地图访问授权失败");
      window.location.replace(`${cleanUrl.pathname}${cleanUrl.search}`);
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return;
      setError(requestError instanceof Error ? requestError.message : "地图访问授权失败");
    });
    return () => controller.abort();
  }, [trackingId]);

  return (
    <main className={styles.statePage}>
      <section className={error ? styles.errorCard : styles.stateCard}>
        <span>{error ? "无法打开地图" : "飞驼可视"}</span>
        <h1>{error || "正在验证地图访问权限..."}</h1>
        <p>{error ? "请关闭当前页面，并从小程序的物流详情重新进入。" : "验证完成后将自动显示船舶位置与运输航线。"}</p>
      </section>
    </main>
  );
}
