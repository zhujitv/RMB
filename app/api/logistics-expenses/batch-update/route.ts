import type { NextRequest } from "next/server";
import { apiError, batchUpdateLogisticsExpenses, ok, parseJsonBody } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const rows = await batchUpdateLogisticsExpenses(request, actor, body);
    return ok({ success: true, rows, message: "✓ 已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存本账单明细失败");
  }
}
