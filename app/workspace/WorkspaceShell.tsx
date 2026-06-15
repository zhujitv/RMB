"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiJson } from "./api";
import { AccountSettings } from "./AccountSettings";
import { availableMenus } from "./menu";
import { LoadingPanel } from "./LoadingPanel";
import { LoginPanel } from "./LoginPanel";
import { ModulePlaceholder } from "./ModulePlaceholder";
import { CostsModule } from "./modules/CostsModule";
import { DashboardModule } from "./modules/DashboardModule";
import { DomesticLogisticsModule } from "./modules/DomesticLogisticsModule";
import { ManualModule } from "./modules/ManualModule";
import { OrdersModule } from "./modules/OrdersModule";
import { PaymentsModule } from "./modules/PaymentsModule";
import { ProfitModule } from "./modules/ProfitModule";
import { ReportsModule } from "./modules/ReportsModule";
import { SettingsModule } from "./modules/SettingsModule";
import { TaxRefundModule } from "./modules/TaxRefundModule";
import { PasswordChangePanel } from "./PasswordChangePanel";
import { StatusPanel } from "./StatusPanel";
import styles from "./WorkspaceShell.module.css";
import type { AuthPayload, AuthState, LoginResponse } from "./types";
import { normalizeEmail } from "./utils";
import { WelcomePanel } from "./WelcomePanel";
import { WorkspaceLayout } from "./WorkspaceLayout";

const ALWAYS_ALLOWED_MENUS = ["welcome", "account"];

export function WorkspaceShell() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading", message: "正在加载工作台..." });
  const [activeMenu, setActiveMenu] = useState("welcome");
  const [domesticLogisticsFocus, setDomesticLogisticsFocus] = useState({ keyword: "", token: 0 });
  const [loginBusy, setLoginBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  async function loadCurrentUser() {
    setAuth({ status: "loading", message: "正在加载工作台..." });
    try {
      const payload = await apiJson<AuthPayload>("/api/auth/me");
      if (payload.user.mustChangePassword) {
        setAuth({ status: "password-change", user: payload.user, message: "请先修改初始密码。" });
        return;
      }
      setAuth({ status: "ready", payload });
      setActiveMenu("welcome");
    } catch (error) {
      const message = error instanceof Error ? error.message : "用户信息加载失败";
      if (/请先登录|未登录|登录/i.test(message)) {
        setAuth({ status: "guest" });
      } else {
        setAuth({ status: "error", message: "用户信息加载失败" });
      }
    }
  }

  useEffect(() => {
    void loadCurrentUser();
  }, []);

  const readyPayload = auth.status === "ready" ? auth.payload : null;
  const menus = useMemo(() => {
    if (!readyPayload) return [];
    return availableMenus(readyPayload.user, readyPayload.permissions);
  }, [readyPayload]);

  const allowedMenuKeys = useMemo(() => new Set([...ALWAYS_ALLOWED_MENUS, ...menus.map((item) => item.key)]), [menus]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    if (!allowedMenuKeys.has(activeMenu)) setActiveMenu("welcome");
  }, [activeMenu, allowedMenuKeys, auth.status]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = normalizeEmail(String(form.get("email") || ""));
    const password = String(form.get("password") || "");
    if (!email) {
      setAuth({ status: "guest", message: "请输入邮箱。" });
      return;
    }
    if (!password) {
      setAuth({ status: "guest", message: "请输入密码。" });
      return;
    }
    setLoginBusy(true);
    try {
      const result = await apiJson<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!result.success || !result.user) throw new Error(result.message || "登录失败");
      if (result.mustChangePassword || result.user.mustChangePassword) {
        setAuth({ status: "password-change", user: result.user, message: result.message || "请先修改初始密码。" });
        return;
      }
      await loadCurrentUser();
    } catch (error) {
      setAuth({ status: "guest", message: error instanceof Error ? error.message : "登录失败" });
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      setAuth({ status: "guest", message: "两次输入的密码不一致。" });
      return;
    }
    setRegisterBusy(true);
    try {
      const result = await apiJson<{ message?: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") || "").trim(),
          email: normalizeEmail(String(form.get("email") || "")),
          password,
        }),
      });
      setRegisterOpen(false);
      setAuth({ status: "guest", message: result.message || "注册申请已提交，请等待管理员审核。" });
    } catch (error) {
      setAuth({ status: "guest", message: error instanceof Error ? error.message : "提交注册申请失败" });
    } finally {
      setRegisterBusy(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setAuth((current) => current.status === "password-change" ? { ...current, message: "两次输入的新密码不一致。" } : current);
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await apiJson<{ message?: string }>("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: String(form.get("currentPassword") || ""),
          newPassword,
          confirmPassword,
        }),
      });
      setAuth({ status: "guest", message: result.message || "密码已修改，请重新登录。" });
    } catch (error) {
      setAuth((current) => current.status === "password-change"
        ? { ...current, message: error instanceof Error ? error.message : "修改密码失败" }
        : current);
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleLogout() {
    await apiJson("/api/auth/logout", { method: "POST" }).catch(() => null);
    setActiveMenu("welcome");
    setAuth({ status: "guest" });
  }

  if (auth.status === "loading") {
    return <LoadingPanel message={auth.message} />;
  }

  if (auth.status === "guest") {
    return (
      <LoginPanel
        message={auth.message}
        loginBusy={loginBusy}
        registerBusy={registerBusy}
        registerOpen={registerOpen}
        onRegisterToggle={setRegisterOpen}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    );
  }

  if (auth.status === "password-change") {
    return (
      <PasswordChangePanel
        user={auth.user}
        message={auth.message}
        busy={passwordBusy}
        onSubmit={handleChangePassword}
        onLogout={handleLogout}
      />
    );
  }

  if (auth.status === "error") {
    return (
      <main className={styles.loadingScreen}>
        <div className={styles.loadingCard}>
          <strong>{auth.message}</strong>
          <button className={styles.secondaryButton} type="button" onClick={loadCurrentUser}>重试</button>
        </div>
      </main>
    );
  }

  const payload = auth.payload;

  function updateCurrentUser(user: AuthPayload["user"]) {
    setAuth((current) => current.status === "ready"
      ? { ...current, payload: { ...current.payload, user } }
      : current);
  }

  return (
    <WorkspaceLayout
      payload={payload}
      menus={menus}
      activeMenu={activeMenu}
      onSelectMenu={setActiveMenu}
      onLogout={handleLogout}
      onPasswordChange={(user) => setAuth({ status: "password-change", user })}
    >
      {activeMenu === "welcome" ? (
        <WelcomePanel payload={payload} menus={menus} onSelectMenu={setActiveMenu} />
      ) : activeMenu === "account" ? (
        <AccountSettings
          user={payload.user}
          onProfileSaved={updateCurrentUser}
          onPasswordChanged={(message) => setAuth({ status: "guest", message })}
        />
      ) : !allowedMenuKeys.has(activeMenu) ? (
        <StatusPanel
          title="无权限访问"
          message="当前账号没有该功能模块权限，请从左侧选择可用菜单。"
          actionLabel="返回工作台首页"
          onAction={() => setActiveMenu("welcome")}
        />
      ) : activeMenu === "orders" ? (
        <OrdersModule />
      ) : activeMenu === "dashboard" ? (
        <DashboardModule />
      ) : activeMenu === "payments" ? (
        <PaymentsModule currentUser={payload.user} />
      ) : activeMenu === "costs" ? (
        <CostsModule currentUser={payload.user} permissions={payload.permissions} />
      ) : activeMenu === "domesticLogistics" ? (
        <DomesticLogisticsModule
          currentUser={payload.user}
          permissions={payload.permissions}
          initialKeyword={domesticLogisticsFocus.keyword}
          initialOpenToken={domesticLogisticsFocus.token}
        />
      ) : activeMenu === "profit" ? (
        <ProfitModule />
      ) : activeMenu === "taxRefund" ? (
        <TaxRefundModule
          currentUser={payload.user}
          permissions={payload.permissions}
          onOpenDomesticLogistics={(keyword) => {
            setDomesticLogisticsFocus({ keyword, token: Date.now() });
            setActiveMenu("domesticLogistics");
          }}
        />
      ) : activeMenu === "reports" ? (
        <ReportsModule />
      ) : activeMenu === "settings" ? (
        <SettingsModule />
      ) : activeMenu === "manual" ? (
        <ManualModule />
      ) : (
        <ModulePlaceholder moduleKey={activeMenu} />
      )}
    </WorkspaceLayout>
  );
}
