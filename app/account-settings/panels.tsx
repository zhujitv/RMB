"use client";

import type { ChangeEvent, FormEvent } from "react";
import { PASSWORD_POLICY_MESSAGE } from "../../lib/password-policy";
import type { User } from "../types";
import styles from "../WorkspaceShell.module.css";
import { formatDateTime } from "./helpers";

export type ProfileFormState = {
  name: string;
  englishName: string;
  avatarInitials: string;
  avatarUrl: string;
};

export type SecurityFormState = {
  loginAlertEnabled: boolean;
};

export type PreferenceFormState = {
  defaultLanguage: string;
  defaultHome: string;
  pageSize: string;
};

type PasswordStrengthView = {
  label: string;
  className: string;
};

export function ProfilePanel({
  user,
  busy,
  avatarText,
  companyName,
  profileForm,
  onSubmit,
  onAvatarUpload,
  onProfileChange,
}: {
  user: User;
  busy: boolean;
  avatarText: string;
  companyName: string;
  profileForm: ProfileFormState;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAvatarUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onProfileChange: (field: keyof ProfileFormState, value: string) => void;
}) {
  return (
    <form className={styles.accountSettingsPanel} onSubmit={onSubmit}>
      <div className={styles.accountAvatarRow}>
        {profileForm.avatarUrl ? (
          <img className={styles.accountAvatarImage} src={profileForm.avatarUrl} alt="用户头像" />
        ) : (
          <span className={styles.avatarLarge}>{avatarText}</span>
        )}
        <div className={styles.accountAvatarActions}>
          <strong>用户头像</strong>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onAvatarUpload} />
          <span className={styles.mutedText}>支持 PNG、JPG、WebP，建议小于 220KB。</span>
        </div>
      </div>
      <div className={styles.accountFormGrid}>
        <label>
          <span>姓名</span>
          <input
            type="text"
            value={profileForm.name}
            onChange={(event) => onProfileChange("name", event.target.value)}
            required
          />
        </label>
        <label>
          <span>英文名</span>
          <input
            type="text"
            value={profileForm.englishName}
            onChange={(event) => onProfileChange("englishName", event.target.value)}
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

export function SecurityPanel({
  user,
  busy,
  strength,
  currentPassword,
  newPassword,
  confirmPassword,
  securityForm,
  passwordPolicyMessage,
  confirmPasswordMessage,
  onSubmit,
  onCurrentPasswordChange,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSecurityChange,
  onSaveSecuritySettings,
}: {
  user: User;
  busy: boolean;
  strength: PasswordStrengthView;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  securityForm: SecurityFormState;
  passwordPolicyMessage: string;
  confirmPasswordMessage: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSecurityChange: (value: boolean) => void;
  onSaveSecuritySettings: () => void;
}) {
  const hasPasswordIssue = Boolean(passwordPolicyMessage || confirmPasswordMessage);

  return (
    <div className={styles.accountSettingsPanel}>
      <form className={styles.accountSecurityGrid} onSubmit={onSubmit}>
        <label>
          <span>当前密码</span>
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => onCurrentPasswordChange(event.target.value)}
            required
          />
        </label>
        <label>
          <span>新密码</span>
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => onNewPasswordChange(event.target.value)}
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
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
            required
          />
        </label>
        <div className={styles.accountSecurityMeta}>
          <span>密码强度</span>
          <strong className={strength.className}>{strength.label}</strong>
          <small>{PASSWORD_POLICY_MESSAGE}</small>
        </div>
        {hasPasswordIssue ? (
          <p className={styles.formMessage}>{passwordPolicyMessage || confirmPasswordMessage}</p>
        ) : null}
        <button className={styles.primaryButtonCompact} type="submit" disabled={busy || hasPasswordIssue}>
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
            onClick={() => onSecurityChange(!securityForm.loginAlertEnabled)}
          >
            <span />
          </button>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={onSaveSecuritySettings} disabled={busy}>
          {busy ? "保存中..." : "保存提醒设置"}
        </button>
      </div>
    </div>
  );
}
