import type { NextRequest } from "next/server";
import { apiError, getActor, ok, parseJsonBody, readShipsgoIntegrationSettings, saveShipsgoIntegrationSettings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return ok({ settings: await readShipsgoIntegrationSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取大掌櫃设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveShipsgoIntegrationSettings(request, actor, body);
    return ok({ success: true, settings, message: "大掌櫃设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存大掌櫃设置失败");
  }
}
