import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, readWechatMiniSettings, saveWechatMiniSettings } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readWechatMiniSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取微信小程序设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const settings = await saveWechatMiniSettings(request, actor, await parseJsonBody(request));
    return ok({ success: true, settings, message: "微信小程序设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存微信小程序设置失败");
  }
}
