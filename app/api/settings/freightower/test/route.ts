import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, testShipsgoIntegrationConnection } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    return ok(await testShipsgoIntegrationConnection(actor, body));
  } catch (error: unknown) {
    return apiError(error, "测试飞驼可视连接失败");
  }
}
