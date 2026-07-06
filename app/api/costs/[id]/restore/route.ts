import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, restoreCost } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const restoreCostTyped = restoreCost as (
  request: NextRequest,
  actor: unknown,
  id: string,
  input?: Record<string, unknown>,
) => Promise<unknown>;

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await restoreCostTyped(request, actor, id, body) as Record<string, unknown>;
    return ok({ success: true, ok: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "恢复成本失败");
  }
}
