import type { NextRequest } from "next/server";
import { apiError, canRead, getOverview, listOrders, listPayments, logServerTiming, ok, requireAdminGlobal, sanitizeForLog, timeServerStep } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

const listOrdersTyped = listOrders as (query: URLSearchParams, actor: unknown) => Promise<unknown[]>;
const listPaymentsTyped = listPayments as (query: URLSearchParams, actor: unknown) => Promise<unknown[]>;

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
    const actor = (await timeServerStep("workbench-init-timing", "ledger.requireApiActor", () => requireApiActor(request), { path }))!;
    userId = actor?.id || "";
    role = actor?.role || "";
    requireAdminGlobal(actor, "无权限访问经营总览");
    const query = new URL(request.url).searchParams;
    const [overview, orders, payments] = await timeServerStep("workbench-init-timing", "ledger.prismaQueries", () => Promise.all([
      getOverview(query, actor),
      canRead(actor, "orders") ? listOrdersTyped(query, actor) : [],
      canRead(actor, "payments") ? listPaymentsTyped(query, actor) : [],
    ]), { path, userId, role });
    outcome = "ready";
    return ok({ overview, orders, payments, costs: [] });
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    outcome = "error";
    console.error("ledger failed", sanitizeForLog({
      path,
      userId,
      role,
      reason: typedError.message || "unknown",
      code: typedError.code || "",
      meta: typedError.meta,
      stack: process.env.NODE_ENV === "production" ? undefined : typedError.stack,
    }));
    return apiError(error, "统计数据加载失败");
  } finally {
    logServerTiming("workbench-init-timing", startedAt, {
      step: "ledger.total",
      path,
      userId,
      role,
      outcome,
    });
  }
}
