import type { NextRequest } from "next/server";
import { apiError, assertWrite, ok, testWechatOfficialConnection } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertWrite(actor, "settings");
    return ok(await testWechatOfficialConnection());
  } catch (error: unknown) {
    return apiError(error, "测试微信公众号连接失败");
  }
}
