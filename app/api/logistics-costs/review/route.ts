import type { NextRequest } from "next/server";
import { apiError, codedError, logServerError, ok, parseJsonBody, reviewLogisticsExpenseBills } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await reviewLogisticsExpenseBills(request, actor, body);
    const message = result.message || (result.emailError
      ? `费用已审核，历史开票通知发送失败：${result.emailError}`
      : "物流费用已审核，已同步成本管理");
    return ok({ ...result, success: result.success !== false, message });
  } catch (error: unknown) {
    return apiError(maskLogisticsReviewTimeoutError(error), "审核物流费用失败");
  }
}

function maskLogisticsReviewTimeoutError(error: unknown) {
  const message = String((error as { message?: string })?.message || "");
  if (!/expired transaction|Transaction API error|timeout|timed out|P2028/i.test(message)) return error;
  logServerError("物流费用审核事务超时", error);
  return codedError("审核失败：系统处理超时，请稍后重试。", 500, "LOGISTICS_REVIEW_TIMEOUT");
}
