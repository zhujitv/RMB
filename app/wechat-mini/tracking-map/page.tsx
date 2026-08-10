import { cookies } from "next/headers";
import {
  getShipsgoOceanTracking,
  requireWechatMiniActorToken,
  WECHAT_MINI_MAP_COOKIE_NAME,
} from "../../../lib/platform-db";
import MapSessionBootstrap from "./map-session-bootstrap";
import styles from "./tracking-map.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "飞驼可视运输地图",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function safeMapUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "i.saas.freightower.com" ? url.toString() : "";
  } catch {
    return "";
  }
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className={styles.statePage}>
      <section className={styles.errorCard}>
        <span>无法打开地图</span>
        <h1>{message}</h1>
        <p>请关闭当前页面，并从小程序物流详情重新进入。</p>
      </section>
    </main>
  );
}

export default async function WechatMiniTrackingMapPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const trackingId = first(params?.trackingId).trim().slice(0, 80);
  const shouldExchange = first(params?.exchange) === "1";
  if (!trackingId) return <ErrorState message="缺少物流跟踪记录。" />;

  const cookieStore = await cookies();
  const token = cookieStore.get(WECHAT_MINI_MAP_COOKIE_NAME)?.value || "";
  if (shouldExchange || !token) return <MapSessionBootstrap trackingId={trackingId} />;

  try {
    const actor = await requireWechatMiniActorToken(token);
    const { tracking } = await getShipsgoOceanTracking(actor, trackingId);
    const mapUrl = safeMapUrl(tracking.mapUrl);
    if (!mapUrl) return <ErrorState message="飞驼暂未返回这票运输的地图。" />;
    const title = tracking.masterBlNo || tracking.bookingNumber || "运输地图";
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <span>飞驼可视运输地图</span>
            <h1>{title}</h1>
          </div>
          <strong>{tracking.currentStatus || tracking.statusLabel || "运输中"}</strong>
        </header>
        <section className={styles.mapFrame}>
          <iframe
            allow="fullscreen"
            referrerPolicy="no-referrer"
            src={mapUrl}
            title={`${title} 飞驼可视运输地图`}
          />
        </section>
      </main>
    );
  } catch (error: unknown) {
    const message = error instanceof Error && (error as Error & { expose?: boolean }).expose
      ? error.message
      : "地图访问已过期或当前账号无权查看。";
    return <ErrorState message={message} />;
  }
}
