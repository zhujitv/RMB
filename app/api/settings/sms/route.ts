import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  parseJsonBody,
  readSmsIntegrationSettings,
  saveSmsIntegrationSettings,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readSmsIntegrationSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取短信设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveSmsIntegrationSettings(request, actor, body);
    return ok({ success: true, settings, message: "短信设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存短信设置失败");
  }
}
