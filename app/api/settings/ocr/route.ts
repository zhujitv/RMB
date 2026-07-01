import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, readOcrIntegrationSettings, saveOcrIntegrationSettings } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readOcrIntegrationSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取OCR设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveOcrIntegrationSettings(request, actor, body);
    return ok({ success: true, settings, message: "OCR设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存OCR设置失败");
  }
}
