import type { NextRequest } from "next/server";
import { apiError, logisticsSupplierStatement, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const rows = await logisticsSupplierStatement(new URL(request.url).searchParams, actor);
    return ok({ success: true, rows });
  } catch (error: unknown) {
    return apiError(error, "读取物流供应商对账单失败");
  }
}
