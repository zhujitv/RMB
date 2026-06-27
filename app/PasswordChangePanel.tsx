"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../lib/password-policy";
import type { User } from "./types";
import styles from "./WorkspaceShell.module.css";

type PasswordChangePanelProps = {
  user: User;
  message?: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
};

export function PasswordChangePanel({ user, message, busy, onSubmit, onLogout }: PasswordChangePanelProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const passwordError = useMemo(() => (
    newPassword && !passwordMeetsPolicy(newPassword) ? PASSWORD_POLICY_MESSAGE : ""
  ), [newPassword]);
  const confirmError = useMemo(() => (
    confirmPassword && newPassword !== confirmPassword ? "两次输入的新密码不一致。" : ""
  ), [confirmPassword, newPassword]);
  const submitDisabled = busy || Boolean(passwordError || confirmError);

  return (
    <main className={styles.loginScreen}>
      <section className={styles.loginCard} aria-label="首次登录修改密码">
        <div className={styles.loginBrand}>
          <h1>首次登录修改密码</h1>
          <p>{user.name} · {user.role}</p>
        </div>
        <form className={styles.authForm} onSubmit={onSubmit}>
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
          {passwordError || confirmError ? <p className={styles.formMessage}>{passwordError || confirmError}</p> : null}
          {message ? <p className={styles.formMessage}>{message}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={submitDisabled}>
            {busy ? "保存中..." : "保存新密码"}
          </button>
          <button className={styles.ghostButton} type="button" onClick={onLogout}>退出登录</button>
        </form>
      </section>
    </main>
  );
}
