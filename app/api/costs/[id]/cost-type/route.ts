import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, updateCostType } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await updateCostType(request, actor, id, body);
    return ok({ success: true, ok: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "更新成本类型失败");
  }
}
