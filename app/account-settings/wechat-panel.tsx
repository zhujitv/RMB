"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { apiJson } from "../api";
import { DismissibleLayer } from "../components/dismissible-layer";
import styles from "../WorkspaceShell.module.css";
import wechatStyles from "./wechat-panel.module.css";

type WechatSubscriptionStatus = {
  available: boolean;
  enabled: boolean;
  accountCertified: boolean;
  credentialsReady: boolean;
  binding: {
    enabled: boolean;
    openIdMasked: string;
    lastConfirmedAt?: string | null;
  } | null;
  attentionRequired: number;
  requirement: string;
};

export function WechatNotificationPanel() {
  const [status, setStatus] = useState<WechatSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bindingQrCode, setBindingQrCode] = useState("");
  const [bindingExpiresAt, setBindingExpiresAt] = useState("");

  async function loadStatus() {
    setLoading(true);
    try {
      const result = await apiJson<{ status?: WechatSubscriptionStatus }>("/api/wechat-official/subscription");
      setStatus(result.status || null);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "读取微信通知状态失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStatus(); }, []);

  useEffect(() => {
    if (!bindingQrCode) return;
    let active = true;
    const timer = window.setInterval(() => {
      void apiJson<{ status?: WechatSubscriptionStatus }>("/api/wechat-official/subscription")
        .then((result) => {
          if (!active || !result.status?.binding?.enabled) return;
          setStatus(result.status);
          setBindingQrCode("");
          setBindingExpiresAt("");
          setMessage("微信公众号绑定成功，可以持续接收物流通知。");
        })
        .catch(() => undefined);
    }, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [bindingQrCode]);

  async function subscribe() {
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<{ authorizationUrl?: string; expiresAt?: string }>("/api/wechat-official/subscription", { method: "POST" });
      if (!result.authorizationUrl) throw new Error("系统未生成微信授权地址");
      if (/MicroMessenger/i.test(window.navigator.userAgent)) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      const qrCode = await QRCode.toDataURL(result.authorizationUrl, {
        width: 300,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#0f172a", light: "#ffffff" },
      });
      setBindingQrCode(qrCode);
      setBindingExpiresAt(result.expiresAt || "");
      setMessage("请使用已经关注公司公众号的微信扫码绑定。");
      setBusy(false);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "创建微信授权失败");
      setBusy(false);
    }
  }

  async function unlink() {
    if (!window.confirm("确定停止此账号的微信物流通知吗？邮件通知不受影响。")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<{ message?: string }>("/api/wechat-official/subscription", { method: "DELETE" });
      setMessage(result.message || "已停止微信通知");
      await loadStatus();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "停止微信通知失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className={styles.accountSettingsPanel}><div className={styles.emptyState}>正在读取微信通知状态...</div></div>;

  return (
    <div className={styles.accountSettingsPanel} inert={busy} aria-busy={busy}>
      <div className={styles.accountSectionHeader}>
        <strong>微信公众号物流通知</strong>
        <button className={styles.secondaryButton} type="button" onClick={() => void loadStatus()} disabled={busy}>刷新</button>
      </div>
      <div className={styles.accountReadonlyGrid}>
        <div>
          <span>接口状态</span>
          <strong>{status?.available ? "可以绑定" : "等待公众号接口配置"}</strong>
        </div>
        <div>
          <span>微信绑定</span>
          <strong>{status?.binding?.enabled ? `已绑定 ${status.binding.openIdMasked}` : "未绑定"}</strong>
        </div>
        <div>
          <span>需核对的推送</span>
          <strong>{status?.attentionRequired || 0} 条</strong>
        </div>
      </div>
      <p className={styles.accountNote}>
        微信绑定一次后即可持续接收物流模板消息；物流变化时默认通知管理员和该订单业务员。陌生关注者无法收到订单信息，只有已登录系统并完成绑定的员工才会进入通知名单。
      </p>
      <p className={styles.accountNote}>绑定前请先关注公司公众号；电脑端点击后直接使用微信扫描二维码，页面会自动确认结果。</p>
      {!status?.available ? <p className={styles.accountNote}>{status?.requirement || "公众号接口尚未启用。"}</p> : null}
      {status?.attentionRequired ? (
        <p className={styles.inlineError}>存在发送结果未知或永久失败的微信通知。系统已停止自动重发，请由管理员核对后让相关用户重新授权。</p>
      ) : null}
      {message ? <p className={styles.formMessage}>{message}</p> : null}
      <div className={styles.accountActions}>
        <button className={styles.primaryButtonCompact} type="button" onClick={() => void subscribe()} disabled={busy || !status?.available}>
          {busy ? "处理中..." : status?.binding?.enabled ? "重新绑定微信" : "绑定微信公众号"}
        </button>
        {status?.binding?.enabled ? (
          <button className={styles.secondaryButton} type="button" onClick={() => void unlink()} disabled={busy}>停止微信通知</button>
        ) : null}
      </div>
      {bindingQrCode ? (
        <DismissibleLayer
          ariaLabel="绑定微信公众号"
          overlayClassName={styles.modalOverlay}
          surfaceClassName={wechatStyles.bindingDialog}
          onClose={() => { setBindingQrCode(""); setBindingExpiresAt(""); }}
        >
          {() => (
            <>
              <div className={wechatStyles.bindingHeader}>
                <div><strong>微信扫码绑定</strong><span>请使用已经关注公司公众号的微信扫一扫</span></div>
                <button type="button" aria-label="关闭" onClick={() => { setBindingQrCode(""); setBindingExpiresAt(""); }}>×</button>
              </div>
              <div className={wechatStyles.qrFrame}>
                <img src={bindingQrCode} alt="微信公众号绑定二维码" width="300" height="300" />
              </div>
              <p>扫码后在微信中确认，当前页面会自动显示绑定成功。</p>
              <small>二维码约 15 分钟内有效{bindingExpiresAt ? ` · ${new Date(bindingExpiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前完成` : ""}</small>
            </>
          )}
        </DismissibleLayer>
      ) : null}
    </div>
  );
}
