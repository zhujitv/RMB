import type { NextRequest } from "next/server";
import { apiError, canWrite, getActor, getExchangeRateSettings, ok, parseJsonBody, saveExchangeRateSettings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type ErrorWithStatus = Error & { status?: number; expose?: boolean };

export async function GET(request: NextRequest) {
  try {
    const actor = (await getActor(request))!;
    if (actor.role !== "管理员" && !canWrite(actor, "exchangeRates")) {
      const error: ErrorWithStatus = new Error("没有权限查看汇率设置");
      error.status = 403;
      error.expose = true;
      throw error;
    }
    return ok({ settings: await getExchangeRateSettings() });
  } catch (error: unknown) {
    return apiError(error, "读取汇率设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveExchangeRateSettings(request, actor, body);
    return ok({ success: true, settings, message: "汇率设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存汇率设置失败");
  }
}
