import type { NextRequest } from "next/server";
import { apiError, ok, repairMissingOrderSalespeople } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const result = await repairMissingOrderSalespeople(request, actor);
    return ok({
      success: true,
      data: result,
      message: `历史订单业务员修正完成：扫描 ${result.scanned} 条，修复 ${result.repaired} 条，无法修复 ${result.unresolved} 条。`,
    });
  } catch (error: unknown) {
    return apiError(error, "修正历史订单业务员失败");
  }
}
