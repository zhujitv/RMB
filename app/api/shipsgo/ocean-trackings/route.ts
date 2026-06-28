import type { NextRequest } from "next/server";
import { apiError, createShipsgoOceanTracking, ok, parseJsonBody } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await createShipsgoOceanTracking(request, actor, body);
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "创建大掌櫃跟踪失败");
  }
}
