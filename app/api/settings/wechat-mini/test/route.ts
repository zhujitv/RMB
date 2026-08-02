import type { NextRequest } from "next/server";
import { apiError, assertWrite, ok, testWechatMiniConnection } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertWrite(actor, "settings");
    return ok(await testWechatMiniConnection());
  } catch (error: unknown) {
    return apiError(error, "测试微信小程序连接失败");
  }
}
