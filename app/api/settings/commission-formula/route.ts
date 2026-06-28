import type { NextRequest } from "next/server";
import { apiError, assertRead, getCommissionFormulaSettings, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertRead(actor, "settings");
    return ok({ settings: await getCommissionFormulaSettings() });
  } catch (error: unknown) {
    return apiError(error, "读取提成公式设置失败");
  }
}
