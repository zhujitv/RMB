import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, recoverShipsgoOceanTracking } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await recoverShipsgoOceanTracking(request, actor, body);
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "从大掌櫃同步已有跟踪失败");
  }
}
