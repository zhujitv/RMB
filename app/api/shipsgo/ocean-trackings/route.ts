import type { NextRequest } from "next/server";
import { apiError, createShipsgoOceanTracking, getActor, ok, parseJsonBody } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const result = await createShipsgoOceanTracking(request, actor, body);
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "创建 ShipsGo 跟踪失败");
  }
}
