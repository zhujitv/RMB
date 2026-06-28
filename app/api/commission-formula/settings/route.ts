import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, saveCommissionFormulaSettings } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveCommissionFormulaSettings(request, actor, body);
    return ok({ success: true, settings, message: "提成公式设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存提成公式设置失败");
  }
}
