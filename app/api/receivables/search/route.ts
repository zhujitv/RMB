import type { NextRequest } from "next/server";
import { apiError, ok, searchReceivableOrders } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ orders: await searchReceivableOrders(query, actor) });
  } catch (error: unknown) {
    return apiError(error, "搜索应收订单失败");
  }
}
