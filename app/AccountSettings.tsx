"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../lib/password-policy";
import { LoginRecordsPanel, PreferencesPanel } from "./account-settings/activity-panels";
import { readAvatarFile } from "./account-settings/avatar-file";
import { passwordStrength } from "./account-settings/helpers";
import { type AccountSettingsProps, type AccountTab, type LoginRecord, type LoginRecordsResponse, type PasswordResponse, type ProfileResponse } from "./account-settings/model";
import { AccountSettingsHeader, AccountSettingsTabs } from "./account-settings/navigation";
import { ProfilePanel, SecurityPanel } from "./account-settings/panels";
import { WechatNotificationPanel } from "./account-settings/wechat-panel";
import { apiJson } from "./api";
import { initials } from "./utils";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "./workspace/workspace-tab-context";
import styles from "./WorkspaceShell.module.css";

export function AccountSettings({ user, companyProfile, onProfileSaved, onBeforePasswordChange, onPasswordChanged }: AccountSettingsProps) {
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [loginRecords, setLoginRecords] = useState<LoginRecord[]>([]);
  const [loginRecordsState, setLoginRecordsState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [loginRecordsMessage, setLoginRecordsMessage] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("wechatSubscription")) setTab("wechat");
  }, []);

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
  const profileDirty = profileForm.name !== (user.name || "")
    || profileForm.englishName !== (user.englishName || "")
    || profileForm.avatarInitials !== (user.avatarInitials || "")
    || profileForm.avatarUrl !== (user.avatarUrl || "");
  const securitySettingsDirty = securityForm.loginAlertEnabled !== (user.loginAlertEnabled !== false);
  const securityDirty = securitySettingsDirty || Boolean(currentPassword || newPassword || confirmPassword);
  const preferencesDirty = preferenceForm.defaultLanguage !== (user.defaultLanguage || "zh-CN")
    || preferenceForm.defaultHome !== (user.defaultHome || "welcome")
    || preferenceForm.pageSize !== String(user.pageSize || 20);
  useWorkspaceTabDirty(profileDirty || securityDirty || preferencesDirty);
  useWorkspaceTabBusy(busy);

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
    const password = newPassword;
    const passwordConfirm = confirmPassword;
    if (password !== passwordConfirm) {
      setMessage("两次输入的新密码不一致。");
      return;
    }
    if (!passwordMeetsPolicy(password)) {
      setMessage(PASSWORD_POLICY_MESSAGE);
      return;
    }
    if (!onBeforePasswordChange(profileDirty || securitySettingsDirty || preferencesDirty)) return;
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
    void readAvatarFile(file)
      .then((avatarUrl) => setProfileForm((current) => ({ ...current, avatarUrl })))
      .catch((error) => setMessage(error instanceof Error ? error.message : "头像读取失败，请重新选择。"));
    event.target.value = "";
  }

  return (
    <section className={styles.accountSettingsPage} inert={busy} aria-busy={busy}>
      <AccountSettingsHeader user={user} avatarText={avatarText} avatarUrl={profileForm.avatarUrl} />
      <div className={styles.accountSettingsLayout}>
        <AccountSettingsTabs
          activeTab={tab}
          busy={busy}
          onSelect={(nextTab) => { setTab(nextTab); setMessage(""); }}
        />
        <div className={styles.accountTabContent}>
          {tab === "profile" ? (
            <ProfilePanel
              user={user}
              busy={busy}
              avatarText={avatarText}
              companyName={companyName}
              profileForm={profileForm}
              onSubmit={saveProfile}
              onAvatarUpload={handleAvatarUpload}
              onProfileChange={(field, value) => setProfileForm((current) => ({ ...current, [field]: value }))}
            />
          ) : null}
          {tab === "security" ? (
            <SecurityPanel
              user={user}
              busy={busy}
              strength={strength}
              currentPassword={currentPassword}
              newPassword={newPassword}
              confirmPassword={confirmPassword}
              securityForm={securityForm}
              passwordPolicyMessage={passwordPolicyMessage}
              confirmPasswordMessage={confirmPasswordMessage}
              onSubmit={changePassword}
              onCurrentPasswordChange={setCurrentPassword}
              onNewPasswordChange={setNewPassword}
              onConfirmPasswordChange={setConfirmPassword}
              onSecurityChange={(loginAlertEnabled) => setSecurityForm({ loginAlertEnabled })}
              onSaveSecuritySettings={saveSecuritySettings}
            />
          ) : null}
          {tab === "logins" ? (
            <LoginRecordsPanel
              loginRecords={loginRecords}
              loginRecordsState={loginRecordsState}
              loginRecordsMessage={loginRecordsMessage}
              onRefresh={loadLoginRecords}
            />
          ) : null}
          {tab === "preferences" ? (
            <PreferencesPanel
              busy={busy}
              preferenceForm={preferenceForm}
              onSubmit={savePreferences}
              onPreferenceChange={(field, value) => setPreferenceForm((current) => ({ ...current, [field]: value }))}
            />
          ) : null}
          {tab === "wechat" ? <WechatNotificationPanel /> : null}
          {message ? <p className={styles.formMessage}>{message}</p> : null}
        </div>
      </div>
    </section>
  );
}
