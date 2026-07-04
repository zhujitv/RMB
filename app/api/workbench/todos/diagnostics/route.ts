import type { NextRequest } from "next/server";
import { apiError, codedError, ok } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { listWorkbenchTodoDiagnostics } from "../../../../../lib/platform/workbench-todo-diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    if (!actor) throw codedError("请先登录", 401, "AUTH_REQUIRED");
    if (!["管理员", "财务"].includes(actor.role || "")) {
      throw codedError("无权限查看待办诊断", 403, "TODO_DIAGNOSTICS_FORBIDDEN");
    }
    const searchParams = new URL(request.url).searchParams;
    const orderNos = [
      ...searchParams.getAll("orderNo"),
      ...searchParams.getAll("orderNos").flatMap((value) => value.split(",")),
      searchParams.get("keyword") || "",
    ].map((value) => value.trim()).filter(Boolean);
    return ok({
      success: true,
      ...await listWorkbenchTodoDiagnostics(actor, orderNos),
    });
  } catch (error: unknown) {
    return apiError(error, "待办诊断读取失败");
  }
}
