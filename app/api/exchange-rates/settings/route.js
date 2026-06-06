import { apiError, getActor, getExchangeRateSettings, ok, saveExchangeRateSettings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await getActor(request);
    return ok({ settings: await getExchangeRateSettings() });
  } catch (error) {
    return apiError(error, "读取汇率设置失败");
  }
}

export async function PATCH(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ settings: await saveExchangeRateSettings(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存汇率设置失败");
  }
}
