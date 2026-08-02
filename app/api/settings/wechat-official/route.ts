import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, readWechatOfficialSettings, saveWechatOfficialSettings } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readWechatOfficialSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取微信公众号设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const settings = await saveWechatOfficialSettings(request, actor, await parseJsonBody(request));
    return ok({ success: true, settings, message: "微信公众号通知设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存微信公众号设置失败");
  }
}
