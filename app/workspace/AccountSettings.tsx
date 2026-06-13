"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { apiJson } from "./api";
import type { User } from "./types";
import { initials } from "./utils";
import styles from "./WorkspaceShell.module.css";

type AccountSettingsProps = {
  user: User;
  onProfileSaved: (user: User) => void;
  onPasswordChanged: (message: string) => void;
};

type ProfileResponse = {
  success: boolean;
  user: User;
  message?: string;
};

type PasswordResponse = {
  success: boolean;
  message?: string;
};

export function AccountSettings({ user, onProfileSaved, onPasswordChanged }: AccountSettingsProps) {
  const [tab, setTab] = useState<"profile" | "security">("profile");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const avatar = useMemo(() => user.avatarInitials?.trim() || initials(user.name), [user.avatarInitials, user.name]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<ProfileResponse>("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name") || "").trim(),
          phone: String(form.get("phone") || "").trim(),
          avatarInitials: String(form.get("avatarInitials") || "").trim(),
          defaultLanguage: String(form.get("defaultLanguage") || "zh-CN"),
        }),
      });
      if (!result.success || !result.user) throw new Error(result.message || "个人资料保存失败");
      onProfileSaved(result.user);
      setMessage(result.message || "个人资料已保存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "个人资料保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await apiJson<PasswordResponse>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: String(form.get("currentPassword") || ""),
          newPassword,
          confirmPassword,
        }),
      });
      onPasswordChanged(result.message || "密码已修改，请重新登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "修改密码失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.moduleCard}>
      <div className={styles.accountSettingsHeader}>
        <span className={styles.avatarLarge}>{avatar}</span>
        <div>
          <h2>{user.name}</h2>
          <p>{user.role} · {user.email}</p>
        </div>
      </div>
      <div className={styles.settingsTabs} role="tablist" aria-label="账户设置">
        <button
          className={tab === "profile" ? styles.settingsTabActive : ""}
          type="button"
          onClick={() => {
            setTab("profile");
            setMessage("");
          }}
        >
          账户设置
        </button>
        <button
          className={tab === "security" ? styles.settingsTabActive : ""}
          type="button"
          onClick={() => {
            setTab("security");
            setMessage("");
          }}
        >
          安全设置
        </button>
      </div>
      {tab === "profile" ? (
        <form className={styles.settingsForm} onSubmit={saveProfile}>
          <label>
            <span>姓名</span>
            <input name="name" type="text" defaultValue={user.name} required />
          </label>
          <label>
            <span>联系电话</span>
            <input name="phone" type="tel" defaultValue={user.phone || ""} />
          </label>
          <label>
            <span>头像缩写</span>
            <input name="avatarInitials" type="text" defaultValue={user.avatarInitials || ""} maxLength={8} />
          </label>
          <label>
            <span>默认语言</span>
            <select name="defaultLanguage" defaultValue={user.defaultLanguage || "zh-CN"}>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          {message ? <p className={styles.formMessage}>{message}</p> : null}
          <button className={styles.primaryButtonCompact} type="submit" disabled={busy}>
            {busy ? "保存中..." : "保存修改"}
          </button>
        </form>
      ) : (
        <form className={styles.settingsForm} onSubmit={changePassword}>
          <label>
            <span>当前密码</span>
            <input name="currentPassword" type="password" autoComplete="current-password" required />
          </label>
          <label>
            <span>新密码</span>
            <input name="newPassword" type="password" autoComplete="new-password" required />
          </label>
          <label>
            <span>确认密码</span>
            <input name="confirmPassword" type="password" autoComplete="new-password" required />
          </label>
          {message ? <p className={styles.formMessage}>{message}</p> : null}
          <button className={styles.primaryButtonCompact} type="submit" disabled={busy}>
            {busy ? "保存中..." : "更新密码"}
          </button>
        </form>
      )}
    </section>
  );
}
