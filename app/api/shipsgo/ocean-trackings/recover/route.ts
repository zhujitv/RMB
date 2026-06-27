import type { NextRequest } from "next/server";
import { apiError, getActor, ok, parseJsonBody, recoverShipsgoOceanTracking } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const result = await recoverShipsgoOceanTracking(request, actor, body);
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "从 ShipsGo 同步已有跟踪失败");
  }
}
