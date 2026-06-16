import type { NextRequest } from "next/server";
import { apiError, assertRead, getActor, getExchangeRateSettings, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    assertRead(actor, "settings");
    return ok({ settings: await getExchangeRateSettings() });
  } catch (error: unknown) {
    return apiError(error, "读取汇率设置失败");
  }
}
