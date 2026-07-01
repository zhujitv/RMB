import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, sendNotificationTemplateTest } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    return ok({ success: true, result: await sendNotificationTemplateTest(request, actor, body), message: "测试邮件已发送" });
  } catch (error: unknown) {
    return apiError(error, "发送测试邮件失败");
  }
}
