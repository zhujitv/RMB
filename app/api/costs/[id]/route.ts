import type { NextRequest } from "next/server";
import { apiError, deleteCost, getCost, ok, parseJsonBody, saveCost } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const saveCostTyped = saveCost as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

const getCostTyped = getCost as (id: string, actor: unknown) => Promise<unknown>;
const deleteCostTyped = deleteCost as (
  request: NextRequest,
  actor: unknown,
  id: string,
  input?: Record<string, unknown>,
) => Promise<unknown>;

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    return ok({ success: true, cost: await getCostTyped(id, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取成本详情失败");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    return ok({ success: true, cost: await saveCostTyped(request, actor, body, id) });
  } catch (error: unknown) {
    return apiError(error, "更新成本失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request, { allowEmpty: true });
    const result = await deleteCostTyped(request, actor, id, body) as Record<string, unknown>;
    return ok({ success: true, ok: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "删除成本失败");
  }
}
