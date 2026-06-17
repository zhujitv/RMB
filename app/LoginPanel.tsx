"use client";

import type { FormEvent } from "react";
import styles from "./WorkspaceShell.module.css";

type LoginPanelProps = {
  message?: string;
  loginBusy: boolean;
  registerBusy: boolean;
  registerOpen: boolean;
  onRegisterToggle: (open: boolean) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
};

export function LoginPanel({
  message,
  loginBusy,
  registerBusy,
  registerOpen,
  onRegisterToggle,
  onLogin,
  onRegister,
}: LoginPanelProps) {
  return (
    <main className={styles.loginScreen}>
      <section className={styles.loginCard} aria-label="登录">
        <div className={styles.loginBrand}>
          <h1>NEXTWOOD</h1>
          <p>供应链协同平台</p>
        </div>
        <form className={styles.authForm} onSubmit={onLogin}>
          <label>
            <span>邮箱</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>密码</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {message ? <p className={styles.formMessage}>{message}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={loginBusy}>
            {loginBusy ? "登录中..." : "登录"}
          </button>
        </form>
        <details
          className={styles.registerPanel}
          open={registerOpen}
          onToggle={(event) => onRegisterToggle(event.currentTarget.open)}
        >
          <summary>申请加入平台</summary>
          <form className={styles.authForm} onSubmit={onRegister}>
            <label>
              <span>姓名</span>
              <input name="name" type="text" autoComplete="name" required />
            </label>
            <label>
              <span>邮箱</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              <span>密码</span>
              <input name="password" type="password" autoComplete="new-password" required />
            </label>
            <label>
              <span>确认密码</span>
              <input name="confirmPassword" type="password" autoComplete="new-password" required />
            </label>
            <button className={styles.secondaryButton} type="submit" disabled={registerBusy}>
              {registerBusy ? "提交中..." : "提交审核"}
            </button>
            <small>提交后需管理员审核通过方可登录。</small>
          </form>
        </details>
      </section>
      <footer className={styles.loginFooter}>© 2026 浙江莱诺建材有限公司</footer>
    </main>
  );
}
