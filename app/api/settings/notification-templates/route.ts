import type { NextRequest } from "next/server";
import { apiError, getActor, ok, parseJsonBody, readLogisticsInvoiceNotificationSettings, saveLogisticsInvoiceNotificationSettings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return ok({ settings: await readLogisticsInvoiceNotificationSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取通知模板失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveLogisticsInvoiceNotificationSettings(request, actor, body);
    return ok({ success: true, settings, message: "通知模板已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存通知模板失败");
  }
}
