import type { NextRequest } from "next/server";
import { apiError, getActor, ok, saveCommissionFormulaSettings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const settings = await saveCommissionFormulaSettings(request, actor, body);
    return ok({ success: true, settings, message: "提成公式设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存提成公式设置失败");
  }
}
