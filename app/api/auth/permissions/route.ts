import type { NextRequest } from "next/server";
import { apiError, logServerTiming, ok, readSafeTaxRefundFeatureFlags, rolePermissions, sanitizeForLog, timeServerStep } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type ErrorLike = {
  code?: string;
  message?: string;
  meta?: unknown;
  stack?: string;
};

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const path = new URL(request.url).pathname;
  let userId = "";
  let role = "";
  let outcome = "unknown";
  try {
    const actor = await timeServerStep("workbench-init-timing", "authPermissions.requireApiActor", () => (
      requireApiActor(request)
    ), { path });
    userId = actor?.id || "";
    role = actor?.role || "";
    const permissions = await timeServerStep("workbench-init-timing", "authPermissions.buildBasicPermissions", async () => (
      rolePermissions(actor)
    ), { path, userId, role });
    const taxRefundFeatures = await timeServerStep("workbench-init-timing", "authPermissions.taxRefundFeatureFlags", () => (
      readSafeTaxRefundFeatureFlags({ path, userId, role })
    ), { path, userId, role });
    outcome = "ready";
    return ok({ permissions, features: { taxRefund: taxRefundFeatures } });
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    outcome = "error";
    console.error("auth permissions failed", sanitizeForLog({
      path,
      userId,
      role,
      reason: typedError.message || "unknown",
      code: typedError.code || "",
      meta: typedError.meta,
      stack: process.env.NODE_ENV === "production" ? undefined : typedError.stack,
    }));
    return apiError(error, "权限初始化失败");
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "authPermissions.total",
      path,
      userId,
      role,
      outcome,
    });
  }
}
