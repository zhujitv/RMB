import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  parseJsonBody,
  readNotificationCenterSettings,
  saveLogisticsInvoiceNotificationSettings,
  saveNotificationCenterTemplate,
} from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readNotificationCenterSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取通知模板失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const settings = body.type
      ? await saveNotificationCenterTemplate(request, actor, body)
      : await saveLogisticsInvoiceNotificationSettings(request, actor, body);
    return ok({ success: true, settings, message: "通知模板已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存通知模板失败");
  }
}
