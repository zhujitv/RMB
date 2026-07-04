"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiJson } from "./api";
import { availableMenus } from "./menu";
import { LoadingPanel } from "./LoadingPanel";
import { LoginPanel } from "./LoginPanel";
import { PasswordChangePanel } from "./PasswordChangePanel";
import styles from "./WorkspaceShell.module.css";
import type { AuthPayload, AuthState, CompanyProfileSettings, LoginResponse, PermissionSnapshot, WorkbenchTodo, WorkbenchTodosState } from "./types";
import { normalizeEmail } from "./utils";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceModuleContent } from "./WorkspaceModuleContent";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../lib/password-policy";
import {
  ALWAYS_ALLOWED_MENUS,
  AUTH_BOOT_TIMEOUT_MS,
  EMPTY_WORKBENCH_TODOS,
  PERMISSIONS_BOOT_TIMEOUT_MS,
  PUBLIC_PROFILE_TIMEOUT_MS,
  WORKBENCH_TODOS_TIMEOUT_MS,
  authLoadErrorState,
  normalizeWorkspaceMenuKey,
  validateAuthPayload,
} from "./workspace-auth-helpers";

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
      <WorkspaceModuleContent
        payload={payload}
        menus={menus}
        activeMenu={activeMenu}
        allowedMenuKeys={allowedMenuKeys}
        workbenchTodos={workbenchTodos}
        bootWarnings={bootWarnings}
        ordersFocus={ordersFocus}
        paymentsFocus={paymentsFocus}
        costsFocus={costsFocus}
        profitFocus={profitFocus}
        taxRefundFocus={taxRefundFocus}
        domesticLogisticsFocus={domesticLogisticsFocus}
        customerCommunicationFocus={customerCommunicationFocus}
        oceanControlTowerFocus={oceanControlTowerFocus}
        logisticsFeesFocus={logisticsFeesFocus}
        supplierDocumentsFocus={supplierDocumentsFocus}
        setAuth={setAuth}
        setActiveMenu={setActiveMenu}
        setOrdersFocus={setOrdersFocus}
        setPaymentsFocus={setPaymentsFocus}
        setCostsFocus={setCostsFocus}
        setProfitFocus={setProfitFocus}
        setTaxRefundFocus={setTaxRefundFocus}
        setDomesticLogisticsFocus={setDomesticLogisticsFocus}
        setCustomerCommunicationFocus={setCustomerCommunicationFocus}
        setLogisticsFeesFocus={setLogisticsFeesFocus}
        setSupplierDocumentsFocus={setSupplierDocumentsFocus}
        selectWorkspaceMenu={selectWorkspaceMenu}
        loadWorkbenchTodos={loadWorkbenchTodos}
        openWorkbenchTodo={openWorkbenchTodo}
        updateCurrentUser={updateCurrentUser}
        updateCompanyProfile={updateCompanyProfile}
      />
    </WorkspaceLayout>
  );
}
