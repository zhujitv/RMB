"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import dynamic from "next/dynamic";
import { ApiRequestError, apiJson } from "./api";
import { AccountSettings } from "./AccountSettings";
import { availableMenus } from "./menu";
import { LoadingPanel } from "./LoadingPanel";
import { LoginPanel } from "./LoginPanel";
import { PasswordChangePanel } from "./PasswordChangePanel";
import { StatusPanel } from "./StatusPanel";
import styles from "./WorkspaceShell.module.css";
import type { AuthPayload, AuthState, CompanyProfileSettings, LoginResponse, PermissionSnapshot, WorkbenchTodo, WorkbenchTodosState } from "./types";
import { canWritePermission, normalizeEmail } from "./utils";
import { WelcomePanel } from "./WelcomePanel";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../lib/password-policy";

const ALWAYS_ALLOWED_MENUS = ["welcome", "account"];
const AUTH_BOOT_TIMEOUT_MS = 15000;
const PERMISSIONS_BOOT_TIMEOUT_MS = 8000;
const PUBLIC_PROFILE_TIMEOUT_MS = 8000;
const WORKBENCH_TODOS_TIMEOUT_MS = 12000;

const EMPTY_WORKBENCH_TODOS: WorkbenchTodosState = {
  todos: [],
  completedTodos: [],
  summary: {
    pending: 0,
    todayDue: 0,
    overdue: 0,
    completed: 0,
    total: 0,
    urgent: 0,
  },
  loading: false,
  error: "",
};

function normalizeWorkspaceMenuKey(menuKey: string) {
  return menuKey === "logisticsReview" ? "logisticsFees" : menuKey;
}

const OrdersModule = dynamic(() => import("./modules/OrdersModule").then((module) => module.OrdersModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const DashboardModule = dynamic(() => import("./modules/DashboardModule").then((module) => module.DashboardModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const PaymentsModule = dynamic(() => import("./modules/PaymentsModule").then((module) => module.PaymentsModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const CostsModule = dynamic(() => import("./modules/CostsModule").then((module) => module.CostsModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const DomesticLogisticsModule = dynamic(() => import("./modules/DomesticLogisticsModule").then((module) => module.DomesticLogisticsModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const CustomerCommunicationModule = dynamic(() => import("./modules/CustomerCommunicationModule").then((module) => module.CustomerCommunicationModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const LogisticsFeesModule = dynamic(() => import("./modules/LogisticsFeesModule").then((module) => module.LogisticsFeesModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const SupplierDocumentsModule = dynamic(() => import("./modules/SupplierDocumentsModule").then((module) => module.SupplierDocumentsModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const ProfitModule = dynamic(() => import("./modules/ProfitModule").then((module) => module.ProfitModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const TaxRefundModule = dynamic(() => import("./modules/TaxRefundModule").then((module) => module.TaxRefundModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const ReportsModule = dynamic(() => import("./modules/ReportsModule").then((module) => module.ReportsModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const SettingsModule = dynamic(() => import("./modules/SettingsModule").then((module) => module.SettingsModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});
const ManualModule = dynamic(() => import("./modules/ManualModule").then((module) => module.ManualModule), {
  ssr: false,
  loading: () => <BusinessModuleLoading />,
});

function BusinessModuleLoading() {
  return (
    <section className={styles.moduleCard}>
      <div className={styles.emptyState}>正在加载模块...</div>
    </section>
  );
}

function clearClientAuthState() {
  if (typeof window === "undefined") return;
  ["token", "session", "currentUser", "user", "authToken", "fta_user_id", "fta_session"].forEach((key) => {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  });
}

function withErrorCode(message: string, code?: string | null) {
  const normalizedCode = code || "";
  if (!normalizedCode) return message;
  const suffix = `（错误代码：${normalizedCode}）`;
  return message.includes(suffix) ? message : `${message}${suffix}`;
}

function validateAuthPayload(payload: AuthPayload) {
  if (!payload?.user?.id) throw new Error("账户信息缺少用户ID。");
  if (!payload.user.name) throw new Error("账户信息缺少姓名。");
  if (!payload.user.email) throw new Error("账户信息缺少邮箱。");
  if (!payload.user.role) throw new Error("账户信息缺少角色。");
}

function authLoadErrorState(error: unknown): AuthState {
  const errorCode = error instanceof ApiRequestError ? error.code : "";
  const detail = error instanceof Error ? withErrorCode(error.message, errorCode) : withErrorCode("用户信息加载失败", errorCode);
  if (error instanceof ApiRequestError && [401, 403].includes(error.status)) {
    clearClientAuthState();
    const accountStateCodes = ["EMAIL_NOT_VERIFIED", "USER_PENDING_APPROVAL", "USER_DISABLED", "AUTH_USER_NOT_FOUND"];
    const guestMessage = error.code === "PASSWORD_CHANGE_REQUIRED" || accountStateCodes.includes(error.code || "")
      ? error.message
      : "登录已过期，请重新登录。";
    return {
      status: "guest",
      message: withErrorCode(guestMessage, errorCode),
    };
  }

  if (error instanceof ApiRequestError && error.status === 408) {
    return {
      status: "error",
      message: "无法读取当前用户信息",
      detail,
    };
  }
  if (error instanceof ApiRequestError && error.status >= 500) {
    return {
      status: "error",
      message: "无法读取当前用户信息",
      detail,
    };
  }
  return {
    status: "error",
    message: "无法读取当前用户信息",
    detail,
  };
}

export function WorkspaceShell() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading", message: "正在加载工作台..." });
  const [activeMenu, setActiveMenu] = useState("welcome");
  const [ordersFocus, setOrdersFocus] = useState({ keyword: "", token: 0 });
  const [paymentsFocus, setPaymentsFocus] = useState({ keyword: "", token: 0 });
  const [costsFocus, setCostsFocus] = useState({ keyword: "", token: 0 });
  const [profitFocus, setProfitFocus] = useState({ keyword: "", token: 0 });
  const [taxRefundFocus, setTaxRefundFocus] = useState({ keyword: "", action: "", token: 0 });
  const [domesticLogisticsFocus, setDomesticLogisticsFocus] = useState({ keyword: "", token: 0 });
  const [customerCommunicationFocus, setCustomerCommunicationFocus] = useState({ keyword: "", orderId: "", token: 0 });
  const [oceanControlTowerFocus, setOceanControlTowerFocus] = useState({ keyword: "", token: 0 });
  const [logisticsFeesFocus, setLogisticsFeesFocus] = useState({ keyword: "", billId: "", token: 0 });
  const [supplierDocumentsFocus, setSupplierDocumentsFocus] = useState({ keyword: "", requestId: "", token: 0 });
  const [loginBusy, setLoginBusy] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [publicCompanyProfile, setPublicCompanyProfile] = useState<CompanyProfileSettings | null>(null);
  const [workbenchTodos, setWorkbenchTodos] = useState<WorkbenchTodosState>(EMPTY_WORKBENCH_TODOS);
  const [bootWarnings, setBootWarnings] = useState<string[]>([]);

  function setBootWarning(label: string, error: unknown) {
    const detail = error instanceof Error ? error.message : "";
    const message = detail && detail !== label ? `${label}：${detail}` : label;
    setBootWarnings((current) => [message, ...current.filter((item) => !item.startsWith(label))]);
  }

  async function loadCurrentUser() {
    setAuth({ status: "loading", message: "正在加载工作台..." });
    setBootWarnings([]);
    setWorkbenchTodos(EMPTY_WORKBENCH_TODOS);
    let nextAuth: AuthState | null = null;
    let shouldResetMenu = false;
    let nextDefaultMenu = "welcome";
    try {
      const payload = await apiJson<AuthPayload>("/api/auth/me?basic=1", { timeoutMs: AUTH_BOOT_TIMEOUT_MS });
      validateAuthPayload(payload);
      if (payload.user.mustChangePassword || payload.user.passwordPolicyPassed === false) {
        nextAuth = {
          status: "password-change",
          user: payload.user,
          message: payload.user.passwordPolicyPassed === false
            ? "当前密码安全强度不足，请先修改密码后继续使用平台。"
            : "请先修改初始密码。",
        };
      } else {
        nextAuth = { status: "ready", payload };
        shouldResetMenu = true;
        nextDefaultMenu = payload.user.role === "管理员" && payload.user.defaultHome === "dashboard"
          ? "welcome"
          : payload.user.defaultHome || "welcome";
      }
    } catch (error) {
      nextAuth = authLoadErrorState(error);
    } finally {
      setAuth(nextAuth || { status: "error", message: "无法读取当前用户信息", detail: "初始化流程未返回有效状态。" });
      if (shouldResetMenu) setActiveMenu(nextDefaultMenu);
    }
  }

  useEffect(() => {
    void loadCurrentUser();
  }, []);

  useEffect(() => {
    if (auth.status === "guest") void loadPublicCompanyProfile();
  }, [auth.status]);

  async function loadPublicCompanyProfile() {
    try {
      const result = await apiJson<{ settings?: CompanyProfileSettings }>("/api/company-profile", { timeoutMs: PUBLIC_PROFILE_TIMEOUT_MS });
      setPublicCompanyProfile(result.settings || null);
    } catch {
      setPublicCompanyProfile(null);
    }
  }

  async function loadBasicPermissions() {
    try {
      const result = await apiJson<{ permissions?: PermissionSnapshot }>("/api/auth/permissions", { timeoutMs: PERMISSIONS_BOOT_TIMEOUT_MS });
      setAuth((current) => current.status === "ready"
        ? { ...current, payload: { ...current.payload, permissions: result.permissions } }
        : current);
      setBootWarnings((current) => current.filter((item) => !item.startsWith("权限初始化失败")));
    } catch (error) {
      setBootWarning("权限初始化失败", error);
    }
  }

  async function loadWorkbenchTodos() {
    setWorkbenchTodos((current) => ({ ...current, loading: true, error: "" }));
    try {
      const result = await apiJson<Partial<WorkbenchTodosState>>("/api/workbench/todos", { timeoutMs: WORKBENCH_TODOS_TIMEOUT_MS });
      setWorkbenchTodos({
        todos: Array.isArray(result.todos) ? result.todos : [],
        completedTodos: Array.isArray(result.completedTodos) ? result.completedTodos : [],
        summary: {
          ...EMPTY_WORKBENCH_TODOS.summary,
          ...(result.summary || {}),
        },
        loading: false,
        error: "",
        generatedAt: result.generatedAt,
      });
    } catch (error) {
      setWorkbenchTodos((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error && error.message !== "待办数据加载失败"
          ? `待办数据加载失败：${error.message}`
          : "待办数据加载失败",
      }));
    }
  }

  const readyPayload = auth.status === "ready" ? auth.payload : null;
  const activeCompanyProfile = readyPayload?.companyProfile || publicCompanyProfile;
  const menus = useMemo(() => {
    if (!readyPayload) return [];
    return availableMenus(readyPayload.user, readyPayload.permissions);
  }, [readyPayload]);

  const allowedMenuKeys = useMemo(() => new Set([...ALWAYS_ALLOWED_MENUS, ...menus.map((item) => item.key)]), [menus]);

  function selectWorkspaceMenu(menuKey: string) {
    const normalizedMenuKey = normalizeWorkspaceMenuKey(menuKey);
    if (menuKey === "logisticsReview") setLogisticsFeesFocus({ keyword: "", billId: "", token: Date.now() });
    setActiveMenu(normalizedMenuKey);
  }

  useEffect(() => {
    if (auth.status !== "ready") return;
    if (activeMenu === "logisticsReview") {
      setLogisticsFeesFocus({ keyword: "", billId: "", token: Date.now() });
      setActiveMenu("logisticsFees");
      return;
    }
    if (!allowedMenuKeys.has(activeMenu)) setActiveMenu("welcome");
  }, [activeMenu, allowedMenuKeys, auth.status]);

  useEffect(() => {
    document.title = activeCompanyProfile?.systemName?.trim() || "NEXTWOOD 供应链协同平台";
  }, [activeCompanyProfile?.systemName]);

  useEffect(() => {
    if (auth.status !== "ready") return;
    void loadBasicPermissions();
    void loadWorkbenchTodos();
    void loadPublicCompanyProfile();
  }, [auth.status]);

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
    if (!passwordMeetsPolicy(password)) {
      setAuth({ status: "guest", message: PASSWORD_POLICY_MESSAGE });
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
          confirmPassword,
        }),
      });
      setRegisterOpen(false);
      setAuth({ status: "guest", message: result.message || "注册申请已提交，请先查收邮件完成邮箱验证。验证完成后，管理员审核通过方可登录。" });
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
    if (!passwordMeetsPolicy(newPassword)) {
      setAuth((current) => current.status === "password-change" ? { ...current, message: PASSWORD_POLICY_MESSAGE } : current);
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
    setWorkbenchTodos(EMPTY_WORKBENCH_TODOS);
    setAuth({ status: "guest" });
  }

  if (auth.status === "loading") {
    return <LoadingPanel message={auth.message} />;
  }

  if (auth.status === "guest") {
    return (
      <LoginPanel
        message={auth.message}
        companyProfile={publicCompanyProfile}
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
          {auth.detail ? <p>{auth.detail}</p> : null}
          <div className={styles.loadingActions}>
            <button className={styles.primaryButtonCompact} type="button" onClick={loadCurrentUser}>重新加载</button>
            <button className={styles.secondaryButton} type="button" onClick={handleLogout}>退出登录</button>
          </div>
        </div>
      </main>
    );
  }

  function updateCurrentUser(user: AuthPayload["user"]) {
    setAuth((current) => current.status === "ready"
      ? { ...current, payload: { ...current.payload, user } }
      : current);
  }

  function updateCompanyProfile(settings: CompanyProfileSettings) {
    setPublicCompanyProfile(settings);
    setAuth((current) => current.status === "ready"
      ? { ...current, payload: { ...current.payload, companyProfile: settings } }
      : current);
  }

  function openWorkbenchTodo(todo: WorkbenchTodo) {
    const href = todo.action?.href || "";
    const parsed = new URL(href || "/", "https://workspace.local");
    const path = parsed.pathname.replace(/^\/+/, "");
    const keyword = parsed.searchParams.get("keyword") || todo.orderNo || "";
    const token = Date.now();
    if (path === "orders") {
      setOrdersFocus({ keyword, token });
      setActiveMenu("orders");
      return;
    }
    if (path === "payments") {
      setPaymentsFocus({ keyword, token });
      setActiveMenu("payments");
      return;
    }
    if (path === "costs") {
      setCostsFocus({ keyword, token });
      setActiveMenu("costs");
      return;
    }
    if (path === "profit") {
      setProfitFocus({ keyword, token });
      setActiveMenu("profit");
      return;
    }
    if (path === "domestic-logistics") {
      setDomesticLogisticsFocus({ keyword, token });
      setActiveMenu("domesticLogistics");
      return;
    }
    if (path === "customer-communication") {
      setCustomerCommunicationFocus({
        keyword,
        orderId: parsed.searchParams.get("orderId") || "",
        token,
      });
      setActiveMenu("customerCommunication");
      return;
    }
    if (path === "ocean-control-tower") {
      setOceanControlTowerFocus({ keyword, token });
      setActiveMenu("oceanControlTower");
      return;
    }
    if (path === "logistics-fees") {
      setLogisticsFeesFocus({
        keyword,
        billId: parsed.searchParams.get("billId") || "",
        token,
      });
      setActiveMenu("logisticsFees");
      return;
    }
    if (path === "supplier-documents") {
      setSupplierDocumentsFocus({
        keyword,
        requestId: parsed.searchParams.get("requestId") || "",
        token,
      });
      setActiveMenu("supplierDocuments");
      return;
    }
    if (path === "tax-refund") {
      setTaxRefundFocus({ keyword, action: parsed.searchParams.get("action") || "", token });
      setActiveMenu("taxRefund");
      return;
    }
    setActiveMenu("welcome");
  }

  const payload = publicCompanyProfile && !auth.payload.companyProfile
    ? { ...auth.payload, companyProfile: publicCompanyProfile }
    : auth.payload;

  return (
    <WorkspaceLayout
      payload={payload}
      menus={menus}
      activeMenu={activeMenu}
      onSelectMenu={selectWorkspaceMenu}
      onLogout={handleLogout}
      onPasswordChange={(user) => setAuth({ status: "password-change", user })}
      workbenchTodos={workbenchTodos}
      onRefreshTodos={loadWorkbenchTodos}
      onOpenTodo={openWorkbenchTodo}
    >
      {activeMenu === "welcome" ? (
        <WelcomePanel
          payload={payload}
          menus={menus}
          todosState={workbenchTodos}
          bootWarnings={bootWarnings}
          onSelectMenu={selectWorkspaceMenu}
          onRefreshTodos={loadWorkbenchTodos}
          onOpenTodo={openWorkbenchTodo}
        />
      ) : activeMenu === "account" ? (
        <AccountSettings
          user={payload.user}
          companyProfile={payload.companyProfile}
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
        <OrdersModule
          currentUser={payload.user}
          permissions={payload.permissions}
          initialKeyword={ordersFocus.keyword}
          initialOpenToken={ordersFocus.token}
        />
      ) : activeMenu === "dashboard" ? (
        <DashboardModule />
      ) : activeMenu === "payments" ? (
        <PaymentsModule
          currentUser={payload.user}
          initialKeyword={paymentsFocus.keyword}
          initialOpenToken={paymentsFocus.token}
        />
      ) : activeMenu === "costs" ? (
        <CostsModule
          currentUser={payload.user}
          permissions={payload.permissions}
          initialKeyword={costsFocus.keyword}
          initialOpenToken={costsFocus.token}
        />
      ) : activeMenu === "domesticLogistics" ? (
        <DomesticLogisticsModule
          currentUser={payload.user}
          permissions={payload.permissions}
          initialKeyword={domesticLogisticsFocus.keyword}
          initialOpenToken={domesticLogisticsFocus.token}
          onOpenLogisticsFees={(focus) => {
            setLogisticsFeesFocus({
              keyword: focus.keyword?.trim() || "",
              billId: focus.billId?.trim() || "",
              token: Date.now(),
            });
            setActiveMenu("logisticsFees");
          }}
        />
      ) : activeMenu === "logisticsFees" ? (
        <LogisticsFeesModule
          title="物流费用"
          focusBillId={logisticsFeesFocus.billId}
          focusKeyword={logisticsFeesFocus.keyword}
          focusToken={logisticsFeesFocus.token}
          currentUserRole={payload.user.role}
          currentUserSupplierId={payload.user.supplierId || ""}
          canCreateExpense={canWritePermission(payload.user, payload.permissions, "logistics", ["管理员", "物流供应商"])}
        />
      ) : activeMenu === "customerCommunication" ? (
        <CustomerCommunicationModule
          currentUser={payload.user}
          permissions={payload.permissions}
          initialKeyword={customerCommunicationFocus.keyword}
          initialOrderId={customerCommunicationFocus.orderId}
          initialOpenToken={customerCommunicationFocus.token}
        />
      ) : activeMenu === "oceanControlTower" ? (
        <DomesticLogisticsModule
          currentUser={payload.user}
          permissions={payload.permissions}
          initialKeyword={oceanControlTowerFocus.keyword}
          initialOpenToken={oceanControlTowerFocus.token}
          initialView="controlTower"
          initialControlTowerFullscreen
        />
      ) : activeMenu === "supplierDocuments" ? (
        <SupplierDocumentsModule
          currentUser={payload.user}
          initialKeyword={supplierDocumentsFocus.keyword}
          initialRequestId={supplierDocumentsFocus.requestId}
          initialOpenToken={supplierDocumentsFocus.token}
          onRefreshTodos={loadWorkbenchTodos}
        />
      ) : activeMenu === "profit" ? (
        <ProfitModule
          currentUser={payload.user}
          initialKeyword={profitFocus.keyword}
          initialOpenToken={profitFocus.token}
        />
      ) : activeMenu === "taxRefund" ? (
        <TaxRefundModule
          currentUser={payload.user}
          permissions={payload.permissions}
          initialKeyword={taxRefundFocus.keyword}
          initialAction={taxRefundFocus.action}
          initialOpenToken={taxRefundFocus.token}
          onOpenDomesticLogistics={(keyword) => {
            setDomesticLogisticsFocus({ keyword, token: Date.now() });
            setActiveMenu("domesticLogistics");
          }}
          onOpenSupplierDocuments={(keyword) => {
            setSupplierDocumentsFocus({ keyword: keyword.trim(), requestId: "", token: Date.now() });
            setActiveMenu("supplierDocuments");
          }}
        />
      ) : activeMenu === "reports" ? (
        <ReportsModule
          currentUser={payload.user}
          permissions={payload.permissions}
          onOpenRecord={(targetMenu, keyword) => {
            const value = keyword.trim();
            if (targetMenu === "orders") {
              setOrdersFocus({ keyword: value, token: Date.now() });
            } else if (targetMenu === "payments") {
              setPaymentsFocus({ keyword: value, token: Date.now() });
            } else if (targetMenu === "costs") {
              setCostsFocus({ keyword: value, token: Date.now() });
            } else if (targetMenu === "profit") {
              setProfitFocus({ keyword: value, token: Date.now() });
            } else if (targetMenu === "taxRefund") {
              setTaxRefundFocus({ keyword: value, action: "", token: Date.now() });
            }
            setActiveMenu(targetMenu);
          }}
        />
      ) : activeMenu === "settings" ? (
        <SettingsModule onCompanyProfileSaved={updateCompanyProfile} />
      ) : activeMenu === "manual" ? (
        <ManualModule />
      ) : (
        <StatusPanel
          title="功能暂不可用"
          message="该功能入口暂未开放，请从左侧选择可用的业务模块。"
          actionLabel="返回工作台首页"
          onAction={() => setActiveMenu("welcome")}
        />
      )}
    </WorkspaceLayout>
  );
}
