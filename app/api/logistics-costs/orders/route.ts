import type { NextRequest } from "next/server";
import { apiError, listLogisticsExpenseOrders, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const rows = await listLogisticsExpenseOrders(new URL(request.url).searchParams, actor);
    return ok({ success: true, rows });
  } catch (error: unknown) {
    return apiError(error, "读取可录入物流费用订单失败");
  }
}
