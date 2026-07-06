import type { NextRequest } from "next/server";
import { apiError, batchVoidCosts, ok, parseJsonBody } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

const batchVoidCostsTyped = batchVoidCosts as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
) => Promise<unknown>;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await batchVoidCostsTyped(request, actor, body) as Record<string, unknown>;
    return ok({ success: true, ok: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "批量作废成本失败");
  }
}
