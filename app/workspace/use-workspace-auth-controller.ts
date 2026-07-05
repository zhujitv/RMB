import { useEffect, useState, type FormEvent } from "react";
import { apiJson } from "../api";
import type { AuthPayload, AuthState, CompanyProfileSettings, LoginResponse, PermissionSnapshot, WorkbenchTodosState } from "../types";
import { normalizeEmail } from "../utils";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../lib/password-policy";
import {
  AUTH_BOOT_TIMEOUT_MS,
  EMPTY_WORKBENCH_TODOS,
  PERMISSIONS_BOOT_TIMEOUT_MS,
  PUBLIC_PROFILE_TIMEOUT_MS,
  WORKBENCH_TODOS_TIMEOUT_MS,
  authLoadErrorState,
  validateAuthPayload,
} from "../workspace-auth-helpers";

export function useWorkspaceAuthController({
  setActiveMenu,
}: {
  setActiveMenu: (menu: string) => void;
}) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading", message: "正在加载工作台..." });
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
    setBootWarnings((current) => [...current.filter((item) => !item.startsWith(label)), message]);
  }

  async function loadCurrentUser() {
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

  async function loadWorkbenchTodos(options: { refresh?: boolean } = {}) {
    setWorkbenchTodos((current) => ({ ...current, loading: true, error: "" }));
    try {
      const result = await apiJson<Partial<WorkbenchTodosState>>(options.refresh ? "/api/workbench/todos?refresh=1" : "/api/workbench/todos", { timeoutMs: WORKBENCH_TODOS_TIMEOUT_MS });
      setWorkbenchTodos({
        todos: Array.isArray(result.todos) ? result.todos : [],
        completedTodos: Array.isArray(result.completedTodos) ? result.completedTodos : [],
        summary: { ...EMPTY_WORKBENCH_TODOS.summary, ...(result.summary || {}) },
        loading: false,
        error: "",
        generatedAt: result.generatedAt,
      });
    } catch (error) {
      setWorkbenchTodos((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "读取待办失败",
      }));
    }
  }

  useEffect(() => {
    void loadCurrentUser();
  }, []);

  useEffect(() => {
    if (auth.status === "guest") void loadPublicCompanyProfile();
  }, [auth.status]);

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
    if (!email || !password) {
      setAuth({ status: "guest", message: !email ? "请输入邮箱。" : "请输入密码。" });
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
    if (password !== confirmPassword || !passwordMeetsPolicy(password)) {
      setAuth({ status: "guest", message: password !== confirmPassword ? "两次输入的密码不一致。" : PASSWORD_POLICY_MESSAGE });
      return;
    }
    setRegisterBusy(true);
    try {
      const result = await apiJson<{ message?: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email: normalizeEmail(String(form.get("email") || "")), password, confirmPassword }),
      });
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
    if (newPassword !== confirmPassword || !passwordMeetsPolicy(newPassword)) {
      setAuth((current) => current.status === "password-change"
        ? { ...current, message: newPassword !== confirmPassword ? "两次输入的新密码不一致。" : PASSWORD_POLICY_MESSAGE }
        : current);
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

  function updateCurrentUser(user: AuthPayload["user"]) {
    setAuth((current) => current.status === "ready" ? { ...current, payload: { ...current.payload, user } } : current);
  }

  function updateCompanyProfile(settings: CompanyProfileSettings) {
    setPublicCompanyProfile(settings);
    setAuth((current) => current.status === "ready" ? { ...current, payload: { ...current.payload, companyProfile: settings } } : current);
  }

  return {
    auth,
    bootWarnings,
    loginBusy,
    registerBusy,
    registerOpen,
    passwordBusy,
    publicCompanyProfile,
    workbenchTodos,
    setAuth,
    setRegisterOpen,
    handleLogin,
    handleRegister,
    handleChangePassword,
    handleLogout,
    loadWorkbenchTodos,
    updateCurrentUser,
    updateCompanyProfile,
  };
}
