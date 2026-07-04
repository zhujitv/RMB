import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { nonEmpty } from "./shared-base-utils";
import {
  PRODUCT_SUPPLIER_OPERATOR_ROLES,
  ROLES,
  USER_APPROVAL_STATUSES,
  isProductSupplierOperatorRole,
} from "./shared-constants";
import { assertRead, type AccessUser } from "./shared-access";
import { pageParams, pageResult } from "./shared-permission-data";
import { ensureDefaultUsers } from "./shared-users-bootstrap";
import { type ActorLike, type UserListOptions, type UserListQuery, USER_PUBLIC_SELECT, serializeUser } from "./shared-users-types";

export async function listUsers(actor: ActorLike, query: UserListQuery = null, options: UserListOptions = {}) {
  assertRead(actor, "users");
  await ensureDefaultUsers();
  const keyword = nonEmpty(query?.get("keyword") || query?.get("q") || query?.get("search"));
  const role = nonEmpty(query?.get("role"));
  const statusText = nonEmpty(query?.get("status") || query?.get("approvalStatus"));
  const statusMap = {
    active: "APPROVED",
    enabled: "APPROVED",
    approved: "APPROVED",
    pending: "PENDING",
    rejected: "REJECTED",
    disabled: "DISABLED",
    inactive: "DISABLED",
    "启用": "APPROVED",
    "已通过": "APPROVED",
    "待审核": "PENDING",
    "已拒绝": "REJECTED",
    "停用": "DISABLED",
    "已停用": "DISABLED",
  } satisfies Record<string, string>;
  const emailVerified = ["email_verified", "EMAIL_VERIFIED", "已验证"].includes(statusText);
  const emailUnverified = ["email_unverified", "EMAIL_UNVERIFIED", "邮箱未验证", "未验证"].includes(statusText);
  const approvalStatus = statusText
    ? (USER_APPROVAL_STATUSES.includes(statusText) ? statusText : (statusMap as Record<string, string>)[statusText.toLowerCase()] || (statusMap as Record<string, string>)[statusText] || "")
    : "";
  const where: Prisma.UserWhereInput = {
    ...(keyword ? {
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { email: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
    ...(isProductSupplierOperatorRole(role)
      ? { role: { in: PRODUCT_SUPPLIER_OPERATOR_ROLES } }
      : (ROLES.includes(role) ? { role } : {})),
    ...(USER_APPROVAL_STATUSES.includes(approvalStatus) ? { approvalStatus } : {}),
    ...(emailVerified ? { emailVerified: true } : {}),
    ...(emailUnverified ? { emailVerified: false } : {}),
  };
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 100);
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        orderBy: [{ createdAt: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageResult(users.map(serializeUser), total, page, pageSize);
  }
  const users = await prisma.user.findMany({
    where,
    select: USER_PUBLIC_SELECT,
    orderBy: [{ createdAt: "asc" }],
    take: 1000,
  });
  return users.map(serializeUser);
}
