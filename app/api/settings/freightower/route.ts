import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, readShipsgoIntegrationSettings, saveShipsgoIntegrationSettings } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readShipsgoIntegrationSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取飞驼可视设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveShipsgoIntegrationSettings(request, actor, body);
    return ok({ success: true, settings, message: "飞驼可视设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存飞驼可视设置失败");
  }
}
