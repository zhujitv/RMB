"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../api";
import styles from "../WorkspaceShell.module.css";

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
  availableGrants: number;
  attentionRequired: number;
  requirement: string;
};

export function WechatNotificationPanel() {
  const [status, setStatus] = useState<WechatSubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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

  async function subscribe() {
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<{ authorizationUrl?: string }>("/api/wechat-official/subscription", { method: "POST" });
      if (!result.authorizationUrl) throw new Error("系统未生成微信授权地址");
      window.location.assign(result.authorizationUrl);
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
          <strong>{status?.available ? "可授权" : "等待企业认证与接口配置"}</strong>
        </div>
        <div>
          <span>微信绑定</span>
          <strong>{status?.binding?.enabled ? `已绑定 ${status.binding.openIdMasked}` : "未绑定"}</strong>
        </div>
        <div>
          <span>可用推送次数</span>
          <strong>{status?.availableGrants || 0} 次</strong>
        </div>
        <div>
          <span>需核对的推送</span>
          <strong>{status?.attentionRequired || 0} 条</strong>
        </div>
      </div>
      <p className={styles.accountNote}>
        每授权一次，微信只允许发送一条订阅消息；物流变化时默认通知管理员和该订单业务员。陌生关注者无法收到订单信息，只有已登录并完成授权的系统用户才会绑定。
      </p>
      {!status?.available ? <p className={styles.accountNote}>{status?.requirement || "公众号接口尚未启用。"}</p> : null}
      {status?.attentionRequired ? (
        <p className={styles.inlineError}>存在发送结果未知或永久失败的微信通知。系统已停止自动重发，请由管理员核对后让相关用户重新授权。</p>
      ) : null}
      {message ? <p className={styles.formMessage}>{message}</p> : null}
      <div className={styles.accountActions}>
        <button className={styles.primaryButtonCompact} type="button" onClick={() => void subscribe()} disabled={busy || !status?.available}>
          {busy ? "处理中..." : "在微信中授权一次通知"}
        </button>
        {status?.binding?.enabled ? (
          <button className={styles.secondaryButton} type="button" onClick={() => void unlink()} disabled={busy}>停止微信通知</button>
        ) : null}
      </div>
    </div>
  );
}
