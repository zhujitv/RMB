import type { NextRequest } from "next/server";
import { apiError, logServerTiming, ok, sanitizeForLog, timeServerStep } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";
import { listWorkbenchTodos } from "../../../../lib/platform/workbench-todos";

export const dynamic = "force-dynamic";

type ErrorLike = {
  code?: string;
  message?: string;
  meta?: unknown;
  stack?: string;
};

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const path = url.pathname;
  const bypassCache = ["1", "true", "yes"].includes((url.searchParams.get("refresh") || "").toLowerCase());
  let userId = "";
  let role = "";
  let outcome = "unknown";
  try {
    const actor = await timeServerStep("workbench-init-timing", "workbenchTodos.requireApiActor", () => requireApiActor(request), { path });
    userId = actor?.id || "";
    role = actor?.role || "";
    const result = await timeServerStep("workbench-init-timing", "workbenchTodos.prismaQueries", () => (
      listWorkbenchTodos(actor, { bypassCache })
    ), { path, userId, role, bypassCache });
    outcome = "ready";
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    outcome = "error";
    console.error("workbench todos failed", sanitizeForLog({
      path,
      userId,
      role,
      reason: typedError.message || "unknown",
      code: typedError.code || "",
      meta: typedError.meta,
      stack: process.env.NODE_ENV === "production" ? undefined : typedError.stack,
    }));
    return apiError(error, "待办数据加载失败");
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "workbenchTodos.total",
      path,
      userId,
      role,
      outcome,
    });
  }
}
