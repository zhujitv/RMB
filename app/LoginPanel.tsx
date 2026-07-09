"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../lib/password-policy";
import styles from "./WorkspaceShell.module.css";
import type { CompanyProfileSettings } from "./types";

type LoginPanelProps = {
  message?: string;
  companyProfile?: CompanyProfileSettings | null;
  loginBusy: boolean;
  registerBusy: boolean;
  registerOpen: boolean;
  registerMessage?: string;
  onRegisterToggle: (open: boolean) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: (event: FormEvent<HTMLFormElement>) => void;
};

export function LoginPanel({
  message,
  companyProfile,
  loginBusy,
  registerBusy,
  registerOpen,
  registerMessage,
  onRegisterToggle,
  onLogin,
  onRegister,
}: LoginPanelProps) {
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const brandName = companyProfile?.brandName?.trim() || "NEXTWOOD";
  const logoUrl = companyProfile?.logoUrl?.trim() || "";
  const footerText = typeof companyProfile?.footerText === "string"
    ? companyProfile.footerText.trim()
    : "© 2026 Zhejiang Lainuo Building Materials Co., Ltd.";
  const registerPasswordError = useMemo(() => (
    registerPassword && !passwordMeetsPolicy(registerPassword) ? PASSWORD_POLICY_MESSAGE : ""
  ), [registerPassword]);
  const registerConfirmError = useMemo(() => (
    registerConfirmPassword && registerPassword !== registerConfirmPassword ? "两次输入的密码不一致。" : ""
  ), [registerConfirmPassword, registerPassword]);
  const registerSubmitDisabled = registerBusy || Boolean(registerPasswordError || registerConfirmError);

  useEffect(() => {
    if (!registerOpen) {
      setRegisterPassword("");
      setRegisterConfirmPassword("");
    }
  }, [registerOpen]);

  return (
    <main className={styles.loginScreen}>
      <div className={styles.loginAmbientGlow} aria-hidden="true" />
      <section className={styles.loginLayout} aria-label={`${brandName} 登录`}>
        <div className={styles.loginBrand}>
          {logoUrl ? <img className={styles.loginBrandLogo} src={logoUrl} alt={`${brandName} logo`} /> : null}
          <h1>{brandName}</h1>
        </div>

        <section className={styles.loginCard} aria-label="登录">
          <div className={styles.loginCardHeader}>
            <span>企业账号</span>
            <h2>欢迎登录</h2>
          </div>
          <form className={`${styles.authForm} ${styles.loginAuthForm}`} onSubmit={onLogin}>
            <label>
              <span>邮箱</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              <span>密码</span>
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {message ? <p className={styles.formMessage}>{message}</p> : null}
            <button className={styles.loginSubmitButton} type="submit" disabled={loginBusy}>
              {loginBusy ? "登录中..." : "登录"}
            </button>
          </form>
          <div className={styles.loginRegisterLine}>
            <span>没有账号？</span>
            <button type="button" onClick={() => onRegisterToggle(true)}>
              申请加入平台
            </button>
          </div>
        </section>
      </section>

      {registerOpen ? (
        <div className={styles.loginModalLayer} role="presentation">
          <div className={styles.loginModalBackdrop} onClick={() => onRegisterToggle(false)} />
          <section className={styles.loginModalCard} role="dialog" aria-modal="true" aria-label="申请加入平台">
            <div className={styles.loginModalHeader}>
              <div>
                <span>平台申请</span>
                <h2>申请加入平台</h2>
              </div>
              <button type="button" onClick={() => onRegisterToggle(false)} aria-label="关闭申请表单">
                关闭
              </button>
            </div>
            <form className={`${styles.authForm} ${styles.loginAuthForm}`} onSubmit={onRegister}>
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
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>确认密码</span>
                <input
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={registerConfirmPassword}
                  onChange={(event) => setRegisterConfirmPassword(event.target.value)}
                  required
                />
              </label>
              {registerPasswordError || registerConfirmError || registerMessage ? (
                <p className={styles.formMessage}>{registerPasswordError || registerConfirmError || registerMessage}</p>
              ) : null}
              <button className={styles.loginSubmitButton} type="submit" disabled={registerSubmitDisabled}>
                {registerBusy ? "提交中..." : "提交申请"}
              </button>
              <small>提交后需先完成邮箱验证，再由管理员审核通过方可登录。</small>
            </form>
          </section>
        </div>
      ) : null}
      {footerText ? <footer className={styles.loginFooter}>{footerText}</footer> : null}
    </main>
  );
}
