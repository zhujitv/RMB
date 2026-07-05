"use client";

import type { FormEvent } from "react";
import styles from "../WorkspaceShell.module.css";
import { formatDateTime } from "./helpers";
import { HOME_OPTIONS, type LoginRecord } from "./model";
import type { PreferenceFormState } from "./panels";

export function LoginRecordsPanel({
  loginRecords,
  loginRecordsState,
  loginRecordsMessage,
  onRefresh,
}: {
  loginRecords: LoginRecord[];
  loginRecordsState: "idle" | "loading" | "loaded" | "error";
  loginRecordsMessage: string;
  onRefresh: () => void;
}) {
  return (
    <div className={styles.accountSettingsPanel}>
      <div className={styles.accountSectionHeader}>
        <strong>最近 10 次登录记录</strong>
        <button className={styles.secondaryButton} type="button" onClick={onRefresh} disabled={loginRecordsState === "loading"}>
          {loginRecordsState === "loading" ? "读取中..." : "刷新"}
        </button>
      </div>
      {loginRecordsState === "loading" ? (
        <div className={styles.emptyState}>正在读取登录记录...</div>
      ) : loginRecordsState === "error" ? (
        <div className={styles.emptyState}>{loginRecordsMessage || "登录记录读取失败"}</div>
      ) : loginRecords.length === 0 ? (
        <div className={styles.emptyState}>暂无登录记录</div>
      ) : (
        <div className={styles.accountTableWrapper}>
          <table className={styles.accountTable}>
            <thead>
              <tr>
                <th>登录时间</th>
                <th>IP 地址</th>
                <th>登录地区</th>
                <th>设备 / 浏览器</th>
                <th>登录结果</th>
              </tr>
            </thead>
            <tbody>
              {loginRecords.map((record) => (
                <tr key={record.id}>
                  <td>{formatDateTime(record.loginAt)}</td>
                  <td>{record.ipAddress || "未记录"}</td>
                  <td>{record.region || "未记录"}</td>
                  <td>{record.browser || "未记录"}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${record.result === "成功" ? styles.statusBadgeSuccess : styles.statusBadgeDanger}`}>
                      {record.result || "未记录"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PreferencesPanel({
  busy,
  preferenceForm,
  onSubmit,
  onPreferenceChange,
}: {
  busy: boolean;
  preferenceForm: PreferenceFormState;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPreferenceChange: (field: keyof PreferenceFormState, value: string) => void;
}) {
  return (
    <form className={styles.accountSettingsPanel} onSubmit={onSubmit}>
      <div className={styles.accountFormGrid}>
        <label>
          <span>系统语言</span>
          <select
            value={preferenceForm.defaultLanguage}
            onChange={(event) => onPreferenceChange("defaultLanguage", event.target.value)}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
        <label>
          <span>默认首页</span>
          <select
            value={preferenceForm.defaultHome}
            onChange={(event) => onPreferenceChange("defaultHome", event.target.value)}
          >
            {HOME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>每页显示数量</span>
          <select
            value={preferenceForm.pageSize}
            onChange={(event) => onPreferenceChange("pageSize", event.target.value)}
          >
            <option value="10">10 条</option>
            <option value="20">20 条</option>
            <option value="50">50 条</option>
          </select>
        </label>
      </div>
      <div className={styles.accountActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={busy}>
          {busy ? "保存中..." : "保存偏好设置"}
        </button>
      </div>
    </form>
  );
}
