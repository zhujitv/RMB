import type { NextRequest } from "next/server";
import { apiError, batchSaveLogisticsExpenses, getActor, ok, parseJsonBody } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const result = await batchSaveLogisticsExpenses(request, actor, body);
    return ok({ success: true, ...result, message: "✓ 已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存本账单明细失败");
  }
}
