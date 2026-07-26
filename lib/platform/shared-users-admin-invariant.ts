import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError } from "./shared-base-utils";

type AdministratorState = {
  role?: string | null;
  approvalStatus?: string | null;
  isActive?: boolean | null;
} | null | undefined;

type AdministratorTransactionExecutor = <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

const ADMINISTRATOR_TRANSACTION_MAX_ATTEMPTS = 3;

export const ADMINISTRATOR_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10000,
  timeout: 15000,
};

export function isActiveAdministrator(state: AdministratorState) {
  return state?.role === "管理员"
    && state.approvalStatus === "APPROVED"
    && state.isActive === true;
}

export function isActiveAdministratorDemotion(
  before: AdministratorState,
  nextRole: string,
  nextApprovalStatus: string,
) {
  return isActiveAdministrator(before)
    && (nextRole !== "管理员" || nextApprovalStatus !== "APPROVED");
}

export async function assertAnotherActiveAdministrator(
  tx: Pick<Prisma.TransactionClient, "user">,
  userId: string,
) {
  const anotherAdministrator = await tx.user.findFirst({
    where: {
      id: { not: userId },
      role: "管理员",
      isActive: true,
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!anotherAdministrator) {
    throw codedError("必须至少保留一个已启用的管理员账号。", 409, "LAST_ACTIVE_ADMIN_REQUIRED");
  }
}

export async function assertAdministratorStatusChange(
  tx: Pick<Prisma.TransactionClient, "user">,
  userId: string,
  nextApprovalStatus: string,
) {
  const current = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, approvalStatus: true, isActive: true },
  });
  if (!current) throw codedError("用户不存在", 404, "USER_NOT_FOUND");
  if (isActiveAdministratorDemotion(current, current.role, nextApprovalStatus)) {
    await assertAnotherActiveAdministrator(tx, userId);
  }
}

const executeAdministratorTransaction: AdministratorTransactionExecutor = (operation) => (
  prisma.$transaction(operation, ADMINISTRATOR_TRANSACTION_OPTIONS)
);

export async function runAdministratorInvariantTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  execute: AdministratorTransactionExecutor = executeAdministratorTransaction,
) {
  for (let attempt = 1; attempt <= ADMINISTRATOR_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await execute(operation);
    } catch (error: unknown) {
      if (String((error as { code?: string })?.code || "") !== "P2034") throw error;
      if (attempt === ADMINISTRATOR_TRANSACTION_MAX_ATTEMPTS) {
        throw codedError("管理员资料刚刚被其他操作更新，请刷新后重试。", 409, "ADMIN_UPDATE_CONFLICT");
      }
    }
  }
  throw codedError("管理员资料刚刚被其他操作更新，请刷新后重试。", 409, "ADMIN_UPDATE_CONFLICT");
}
