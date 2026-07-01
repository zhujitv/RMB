import type { NextRequest } from "next/server";
import { apiError, ok } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";
import { listWorkbenchTodos } from "../../../../lib/platform/workbench-todos";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ success: true, ...(await listWorkbenchTodos(actor)) });
  } catch (error: unknown) {
    return apiError(error, "读取工作台待办失败");
  }
}
