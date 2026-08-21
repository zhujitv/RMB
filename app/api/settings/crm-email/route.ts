import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  parseJsonBody,
  readCrmEmailIntegrationSettings,
  saveCrmEmailIntegrationSettings,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readCrmEmailIntegrationSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取 CRM 邮件设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveCrmEmailIntegrationSettings(request, actor, body);
    return ok({ success: true, settings, message: "CRM 邮件设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存 CRM 邮件设置失败");
  }
}
