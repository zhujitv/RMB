import { prisma } from "../prisma";
import { nonEmpty } from "./shared-base-utils";
import { LOGISTICS_OPERATOR_ROLE } from "./shared-constants";
import { DATA_SCOPES, effectivePermissions } from "./shared-permission-data";

type PermissionError = Error & {
  status?: number;
  code?: string;
  expose?: boolean;
};

export type AccessUser = {
  id?: string | null;
  role?: string | null;
} | null | undefined;

type RequestLike = {
  headers: {
    get(name: string): string | null;
  };
};

export function permissionError(message = "没有权限执行该操作", status = 403): PermissionError {
  const error: PermissionError = new Error(message);
  error.status = status;
  if (status === 403) error.code = "PERMISSION_DENIED";
  error.expose = true;
  return error;
}

export function rolePermissions(user: AccessUser) {
  const permissions = effectivePermissions(user);
  return {
    mode: permissions.mode,
    menus: permissions.menus,
    readKeys: permissions.readKeys,
    writeKeys: permissions.writeKeys,
    dataScope: permissions.dataScope,
    scopeText: permissions.scopeText,
    writes: permissions.writes,
    reads: permissions.reads,
  };
}

export function getCurrentUserScope(user: AccessUser) {
  if (!user) return "VIEWER_ALLOWED";
  const permissions = effectivePermissions(user);
  if (user.role === "管理员" && permissions.dataScope === "ALL") return "ADMIN_GLOBAL";
  if (user.role === "业务员" && permissions.dataScope === "OWN") return "SALESPERSON_OWN_CUSTOMERS";
  if (user.role === "财务") return "FINANCE_ALLOWED";
  if (user.role === LOGISTICS_OPERATOR_ROLE) return "LOGISTICS_ALLOWED";
  return "VIEWER_ALLOWED";
}

export function canRead(user: AccessUser, area: string) {
  return Boolean(effectivePermissions(user).reads?.[area]);
}

export function assertRead(user: AccessUser, area: string) {
  if (!canRead(user, area)) {
    throw permissionError("没有权限查看该数据");
  }
}

export function canWrite(user: AccessUser, area: string) {
  return Boolean(effectivePermissions(user).writes?.[area]);
}

export function assertWrite(user: AccessUser, area: string) {
  if (!canWrite(user, area)) {
    throw permissionError("没有权限执行该操作");
  }
}

export function requirePermission(user: AccessUser, area: string, action = "read") {
  if (action === "write") return assertWrite(user, area);
  return assertRead(user, area);
}

export function requireDataScope(user: AccessUser) {
  if (!user) throw permissionError("请先登录", 401);
  const permissions = effectivePermissions(user);
  if (!DATA_SCOPES.includes(permissions.dataScope)) {
    throw permissionError("没有可用的数据范围", 403);
  }
  return permissions.dataScope;
}

export function requireAdminGlobal(user: AccessUser, message = "无权限访问全局数据") {
  if (getCurrentUserScope(user) !== "ADMIN_GLOBAL") {
    throw permissionError(message, 403);
  }
}

export function assertCronSecret(request: RequestLike) {
  const secret = nonEmpty(process.env.CRON_SECRET);
  if (!secret || secret === "change-me") {
    throw permissionError("CRON_SECRET 未配置或仍为默认值", 403);
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw permissionError("定时任务密钥不正确", 401);
  }
}

export async function getCronActor() {
  return prisma.user.findFirst({
    where: { role: "管理员", isActive: true, approvalStatus: "APPROVED" },
    orderBy: [{ createdAt: "asc" }],
  });
}
