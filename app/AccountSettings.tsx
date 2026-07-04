"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiJson } from "./api";
import type { User } from "./types";
import { initials } from "./utils";
import styles from "./WorkspaceShell.module.css";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../lib/password-policy";
import { formatDateTime, passwordStrength } from "./account-settings/helpers";
import { ACCOUNT_TABS, HOME_OPTIONS, type AccountSettingsProps, type AccountTab, type LoginRecord, type LoginRecordsResponse, type PasswordResponse, type ProfileResponse } from "./account-settings/model";

export function AccountSettings({ user, companyProfile, onProfileSaved, onPasswordChanged }: AccountSettingsProps) {
  const [tab, setTab] = useState<AccountTab>("profile");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: user.name || "",
    englishName: user.englishName || "",
    avatarInitials: user.avatarInitials || "",
    avatarUrl: user.avatarUrl || "",
  });
  const [securityForm, setSecurityForm] = useState({
    loginAlertEnabled: user.loginAlertEnabled !== false,
  });
  const [preferenceForm, setPreferenceForm] = useState({
    defaultLanguage: user.defaultLanguage || "zh-CN",
    defaultHome: user.defaultHome || "welcome",
    pageSize: String(user.pageSize || 20),
  });
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginRecords, setLoginRecords] = useState<LoginRecord[]>([]);
  const [loginRecordsState, setLoginRecordsState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [loginRecordsMessage, setLoginRecordsMessage] = useState("");

  useEffect(() => {
    setProfileForm({
      name: user.name || "",
      englishName: user.englishName || "",
      avatarInitials: user.avatarInitials || "",
      avatarUrl: user.avatarUrl || "",
    });
    setSecurityForm({ loginAlertEnabled: user.loginAlertEnabled !== false });
    setPreferenceForm({
      defaultLanguage: user.defaultLanguage || "zh-CN",
      defaultHome: user.defaultHome || "welcome",
      pageSize: String(user.pageSize || 20),
    });
  }, [user.id, user.name, user.englishName, user.avatarInitials, user.avatarUrl, user.loginAlertEnabled, user.defaultLanguage, user.defaultHome, user.pageSize]);

  useEffect(() => {
    if (tab !== "logins" || loginRecordsState !== "idle") return;
    void loadLoginRecords();
  }, [tab, loginRecordsState]);

  const avatarText = useMemo(() => profileForm.avatarInitials.trim() || initials(profileForm.name), [profileForm.avatarInitials, profileForm.name]);
  const companyName = companyProfile?.companyNameZh?.trim()
    || companyProfile?.brandName?.trim()
    || companyProfile?.systemName?.trim()
    || "未设置";
  const strength = useMemo(() => passwordStrength(newPassword), [newPassword]);
  const passwordPolicyMessage = useMemo(() => (
    newPassword && !passwordMeetsPolicy(newPassword) ? PASSWORD_POLICY_MESSAGE : ""
  ), [newPassword]);
  const confirmPasswordMessage = useMemo(() => (
    confirmPassword && newPassword !== confirmPassword ? "两次输入的新密码不一致。" : ""
  ), [confirmPassword, newPassword]);

  function accountPatchPayload(overrides: Partial<{
    name: string;
    englishName: string;
    avatarInitials: string;
    avatarUrl: string;
    loginAlertEnabled: boolean;
    defaultLanguage: string;
    defaultHome: string;
    pageSize: number;
  }> = {}) {
    return {
      name: profileForm.name.trim(),
      englishName: profileForm.englishName.trim(),
      avatarInitials: profileForm.avatarInitials.trim(),
      avatarUrl: profileForm.avatarUrl,
      loginAlertEnabled: securityForm.loginAlertEnabled,
      defaultLanguage: preferenceForm.defaultLanguage,
      defaultHome: preferenceForm.defaultHome,
      pageSize: Number(preferenceForm.pageSize || 20),
      ...overrides,
    };
  }

  async function patchProfile(payload = accountPatchPayload()) {
    const result = await apiJson<ProfileResponse>("/api/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!result.success || !result.user) throw new Error(result.message || "个人设置保存失败");
    onProfileSaved(result.user);
    return result;
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await patchProfile();
      setMessage(result.message || "个人资料已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "个人资料保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveSecuritySettings() {
    setBusy(true);
    setMessage("");
    try {
      const result = await patchProfile();
      setMessage(result.message || "账户安全设置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账户安全设置保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result = await patchProfile();
      setMessage(result.message || "偏好设置已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "偏好设置保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const password = String(form.get("newPassword") || "");
    const passwordConfirm = String(form.get("confirmPassword") || "");
    if (password !== passwordConfirm) {
      setMessage("两次输入的新密码不一致。");
      return;
    }
    if (!passwordMeetsPolicy(password)) {
      setMessage(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<PasswordResponse>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword: password,
          confirmPassword: passwordConfirm,
        }),
      });
      onPasswordChanged(result.message || "密码已修改，请重新登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改密码失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadLoginRecords() {
    setLoginRecordsState("loading");
    setLoginRecordsMessage("");
    try {
      const result = await apiJson<LoginRecordsResponse>("/api/auth/profile");
      setLoginRecords(result.loginRecords || []);
      setLoginRecordsState("loaded");
    } catch (error) {
      setLoginRecordsMessage(error instanceof Error ? error.message : "登录记录读取失败");
      setLoginRecordsState("error");
    }
  }

  function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage("头像仅支持 PNG、JPG 或 WebP 图片。");
      event.target.value = "";
      return;
    }
    if (file.size > 220 * 1024) {
      setMessage("头像文件不能超过 220KB。");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfileForm((current) => ({ ...current, avatarUrl: String(reader.result || "") }));
    };
    reader.onerror = () => setMessage("头像读取失败，请重新选择。");
    reader.readAsDataURL(file);
  }

  function renderProfile() {
    return (
      <form className={styles.accountSettingsPanel} onSubmit={saveProfile}>
        <div className={styles.accountAvatarRow}>
          {profileForm.avatarUrl ? (
            <img className={styles.accountAvatarImage} src={profileForm.avatarUrl} alt="用户头像" />
          ) : (
            <span className={styles.avatarLarge}>{avatarText}</span>
          )}
          <div className={styles.accountAvatarActions}>
            <strong>用户头像</strong>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} />
            <span className={styles.mutedText}>支持 PNG、JPG、WebP，建议小于 220KB。</span>
          </div>
        </div>
        <div className={styles.accountFormGrid}>
          <label>
            <span>姓名</span>
            <input
              type="text"
              value={profileForm.name}
              onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>英文名</span>
            <input
              type="text"
              value={profileForm.englishName}
              onChange={(event) => setProfileForm((current) => ({ ...current, englishName: event.target.value }))}
              placeholder="未设置"
            />
          </label>
          <label>
            <span>登录邮箱</span>
            <input type="email" value={user.email} readOnly />
          </label>
          <label>
            <span>所属公司</span>
            <input type="text" value={companyName} readOnly />
          </label>
          <label>
            <span>所属部门</span>
            <input type="text" value={user.department || "未设置"} readOnly />
          </label>
          <label>
            <span>所属角色</span>
            <input type="text" value={user.role} readOnly />
          </label>
        </div>
        <p className={styles.accountNote}>邮箱、公司、部门和角色由管理员维护，个人账号中仅作展示。</p>
        <div className={styles.accountActions}>
          <button className={styles.primaryButtonCompact} type="submit" disabled={busy}>
            {busy ? "保存中..." : "保存个人资料"}
          </button>
        </div>
      </form>
    );
  }

  function renderSecurity() {
    return (
      <div className={styles.accountSettingsPanel}>
        <form className={styles.accountSecurityGrid} onSubmit={changePassword}>
          <label>
            <span>当前密码</span>
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <label>
            <span>新密码</span>
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label>
            <span>确认密码</span>
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>
          <div className={styles.accountSecurityMeta}>
            <span>密码强度</span>
            <strong className={strength.className}>{strength.label}</strong>
            <small>{PASSWORD_POLICY_MESSAGE}</small>
          </div>
          {passwordPolicyMessage || confirmPasswordMessage ? (
            <p className={styles.formMessage}>{passwordPolicyMessage || confirmPasswordMessage}</p>
          ) : null}
          <button className={styles.primaryButtonCompact} type="submit" disabled={busy || Boolean(passwordPolicyMessage || confirmPasswordMessage)}>
            {busy ? "保存中..." : "修改密码"}
          </button>
        </form>
        <div className={styles.accountReadonlyGrid}>
          <div>
            <span>密码最后修改时间</span>
            <strong>{formatDateTime(user.passwordChangedAt)}</strong>
          </div>
          <div>
            <span>邮箱验证</span>
            <strong>{user.emailVerified === false ? "未验证" : "已验证"}</strong>
          </div>
          <div className={styles.accountSwitchRow}>
            <span>登录异常邮件提醒</span>
            <button
              className={`${styles.uiSwitch} ${securityForm.loginAlertEnabled ? styles.uiSwitchActive : ""}`}
              type="button"
              role="switch"
              aria-checked={securityForm.loginAlertEnabled}
              onClick={() => setSecurityForm((current) => ({ loginAlertEnabled: !current.loginAlertEnabled }))}
            >
              <span />
            </button>
          </div>
          <button className={styles.secondaryButton} type="button" onClick={saveSecuritySettings} disabled={busy}>
            {busy ? "保存中..." : "保存提醒设置"}
          </button>
        </div>
      </div>
    );
  }

  function renderLoginRecords() {
    return (
      <div className={styles.accountSettingsPanel}>
        <div className={styles.accountSectionHeader}>
          <strong>最近 10 次登录记录</strong>
          <button className={styles.secondaryButton} type="button" onClick={loadLoginRecords} disabled={loginRecordsState === "loading"}>
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

  function renderPreferences() {
    return (
      <form className={styles.accountSettingsPanel} onSubmit={savePreferences}>
        <div className={styles.accountFormGrid}>
          <label>
            <span>系统语言</span>
            <select
              value={preferenceForm.defaultLanguage}
              onChange={(event) => setPreferenceForm((current) => ({ ...current, defaultLanguage: event.target.value }))}
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <label>
            <span>默认首页</span>
            <select
              value={preferenceForm.defaultHome}
              onChange={(event) => setPreferenceForm((current) => ({ ...current, defaultHome: event.target.value }))}
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
              onChange={(event) => setPreferenceForm((current) => ({ ...current, pageSize: event.target.value }))}
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

  return (
    <section className={styles.accountSettingsPage}>
      <div className={styles.accountSettingsHeader}>
        {profileForm.avatarUrl ? (
          <img className={styles.accountAvatarImage} src={profileForm.avatarUrl} alt="用户头像" />
        ) : (
          <span className={styles.avatarLarge}>{avatarText}</span>
        )}
        <div>
          <h2>{user.name}</h2>
          <p>{user.role} · {user.email}</p>
        </div>
      </div>
      <div className={styles.accountSettingsLayout}>
        <nav className={styles.accountTabList} aria-label="个人设置">
          {ACCOUNT_TABS.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? styles.accountTabActive : ""}
              type="button"
              onClick={() => {
                setTab(item.key);
                setMessage("");
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className={styles.accountTabContent}>
          {tab === "profile" ? renderProfile() : null}
          {tab === "security" ? renderSecurity() : null}
          {tab === "logins" ? renderLoginRecords() : null}
          {tab === "preferences" ? renderPreferences() : null}
          {message ? <p className={styles.formMessage}>{message}</p> : null}
        </div>
      </div>
    </section>
  );
}
