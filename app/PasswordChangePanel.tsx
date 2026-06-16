"use client";

import type { FormEvent } from "react";
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
            <input name="newPassword" type="password" autoComplete="new-password" required />
          </label>
          <label>
            <span>确认密码</span>
            <input name="confirmPassword" type="password" autoComplete="new-password" required />
          </label>
          {message ? <p className={styles.formMessage}>{message}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={busy}>
            {busy ? "保存中..." : "保存新密码"}
          </button>
          <button className={styles.ghostButton} type="button" onClick={onLogout}>退出登录</button>
        </form>
      </section>
    </main>
  );
}
