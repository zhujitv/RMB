import type { NextRequest } from "next/server";
import {
  apiError,
  assertRead,
  listApiPerformanceMetrics,
  ok,
  parseJsonBody,
  recordApiPerformanceLog,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertRead(actor, "auditLogs");
    const query = new URL(request.url).searchParams;
    const page = await listApiPerformanceMetrics(query, actor);
    return ok({
      metrics: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取慢接口榜单失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request).catch(() => null);
    if (!actor) return ok({ success: true });
    if (actor.role !== "管理员") return ok({ success: true, recorded: false });
    const body = await parseJsonBody(request, { allowEmpty: true });
    const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
    recordApiPerformanceLog({
      source: "client",
      method: payload.method,
      path: payload.path,
      statusCode: payload.statusCode,
      durationMs: payload.durationMs,
      userId: actor.id,
      role: actor.role,
    });
    return ok({ success: true });
  } catch (error: unknown) {
    return apiError(error, "记录慢接口耗时失败");
  }
}
