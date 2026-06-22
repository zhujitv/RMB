import type { NextRequest } from "next/server";
import { apiError, getActor, ok, reviewLogisticsExpenseBills } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const result = await reviewLogisticsExpenseBills(request, actor, body);
    const message = result.emailError
      ? `物流费用已审核，部分开票通知发送失败：${result.emailError}`
      : "物流费用已审核，开票通知已按供应商合并发送";
    return ok({ success: true, ...result, message });
  } catch (error: unknown) {
    return apiError(error, "审核物流费用失败");
  }
}
