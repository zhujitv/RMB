import { prisma } from "../prisma";
import { logServerTiming, nonEmpty, normalizeEmail, timeServerStep } from "./shared-base-utils";
import {
  INITIAL_ADMIN_EMAIL,
  INITIAL_ADMIN_PASSWORD,
} from "./shared-constants";
import { assertSafeInitialAdminConfig, hashPassword, timingSafeEqualText } from "./shared-auth-password";
import { USER_AUTH_SELECT, autoAvatarInitialsFor, resolveAvatarInitials } from "./shared-users-types";

let missingAvatarInitialsBackfilled = false;

export async function backfillMissingAvatarInitials() {
  const startedAt = Date.now();
  if (missingAvatarInitialsBackfilled) {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "backfillMissingAvatarInitials.total",
      skipped: true,
    });
    return;
  }
  missingAvatarInitialsBackfilled = true;
  try {
    const users = await timeServerStep("workbench-init-timing", "backfillMissingAvatarInitials.userLookup", () => prisma.user.findMany({
      select: { id: true, name: true, avatarInitials: true },
      take: 1000,
    }));
    const usersNeedingInitials = users.filter((user) => !nonEmpty(user.avatarInitials));
    await timeServerStep("workbench-init-timing", "backfillMissingAvatarInitials.userUpdates", () => Promise.all(usersNeedingInitials.map((user) => prisma.user.update({
      where: { id: user.id },
      data: { avatarInitials: autoAvatarInitialsFor(user.name) },
    }))), { updateCount: usersNeedingInitials.length });
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "backfillMissingAvatarInitials.total",
      skipped: false,
    });
  }
}

export async function ensureDefaultUsers() {
  const startedAt = Date.now();
  let outcome = "unknown";
  try {
    await timeServerStep("workbench-init-timing", "ensureDefaultUsers.backfillMissingAvatarInitials", () => backfillMissingAvatarInitials());
    const userCount = await timeServerStep("workbench-init-timing", "ensureDefaultUsers.userCount", () => prisma.user.count());
    if (userCount > 0) {
      outcome = "database-not-empty";
      return null;
    }
    if (!INITIAL_ADMIN_EMAIL || !INITIAL_ADMIN_PASSWORD) {
      outcome = "initial-admin-env-missing";
      return null;
    }
    assertSafeInitialAdminConfig();
    const email = normalizeEmail(INITIAL_ADMIN_EMAIL);
    const data = {
      name: nonEmpty(process.env.INITIAL_ADMIN_NAME) || "系统管理员",
      email,
      passwordHash: hashPassword(INITIAL_ADMIN_PASSWORD),
      role: "管理员",
      avatarInitials: resolveAvatarInitials({}, nonEmpty(process.env.INITIAL_ADMIN_NAME) || "系统管理员"),
      mustChangePassword: true,
      passwordPolicyPassed: false,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      approvalStatus: "APPROVED",
      isActive: true,
    };
    await timeServerStep("workbench-init-timing", "ensureDefaultUsers.initialAdminCreate", () => (
      prisma.user.create({ data, select: USER_AUTH_SELECT })
    ), { mode: "create-empty-database" });
    outcome = "initial-admin-created";
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "ensureDefaultUsers.total",
      outcome,
    });
  }
  return null;
}

export function isInitialAdminPasswordLogin(user: { role?: string | null; email?: string | null } | null | undefined, password: unknown) {
  return Boolean(
    INITIAL_ADMIN_EMAIL
    && INITIAL_ADMIN_PASSWORD
    && user?.role === "管理员"
    && normalizeEmail(user.email) === normalizeEmail(INITIAL_ADMIN_EMAIL)
    && timingSafeEqualText(String(password || ""), INITIAL_ADMIN_PASSWORD),
  );
}
