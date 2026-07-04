import { ApiRequestError } from "./api";
import type { AuthPayload, AuthState, WorkbenchTodosState } from "./types";

export const ALWAYS_ALLOWED_MENUS = ["welcome", "account"];
export const AUTH_BOOT_TIMEOUT_MS = 15000;
export const PERMISSIONS_BOOT_TIMEOUT_MS = 8000;
export const PUBLIC_PROFILE_TIMEOUT_MS = 8000;
export const WORKBENCH_TODOS_TIMEOUT_MS = 12000;

export const EMPTY_WORKBENCH_TODOS: WorkbenchTodosState = {
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

export function normalizeWorkspaceMenuKey(menuKey: string) {
  return menuKey === "logisticsReview" ? "logisticsFees" : menuKey;
}

export function clearClientAuthState() {
  if (typeof window === "undefined") return;
  ["token", "session", "currentUser", "user", "authToken", "fta_user_id", "fta_session"].forEach((key) => {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  });
}

export function withErrorCode(message: string, code?: string | null) {
  const normalizedCode = code || "";
  if (!normalizedCode) return message;
  const suffix = `（错误代码：${normalizedCode}）`;
  return message.includes(suffix) ? message : `${message}${suffix}`;
}

export function validateAuthPayload(payload: AuthPayload) {
  if (!payload?.user?.id) throw new Error("账户信息缺少用户ID。");
  if (!payload.user.name) throw new Error("账户信息缺少姓名。");
  if (!payload.user.email) throw new Error("账户信息缺少邮箱。");
  if (!payload.user.role) throw new Error("账户信息缺少角色。");
}

export function authLoadErrorState(error: unknown): AuthState {
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
