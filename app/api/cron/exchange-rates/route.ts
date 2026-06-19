import type { NextRequest } from "next/server";
import { apiError, assertCronSecret, getCronActor, logServerError, ok, refreshExchangeRatesForDate, writeAudit } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type ErrorWithStatus = Error & {
  status?: number;
};

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const actor = await getCronActor();
    if (!actor) {
      const error: ErrorWithStatus = new Error("没有可用于执行定时任务的管理员账号");
      error.status = 500;
      throw error;
    }
    const result = await refreshExchangeRatesForDate();
    writeAudit(
      request,
      actor,
      result.ok ? "自动更新汇率" : "自动更新汇率失败",
      "exchange_rates",
      result.rateDate,
      null,
      result,
    ).catch((error: unknown) => logServerError("自动汇率操作日志写入失败", error, { rateDate: result.rateDate }));
    return ok(result);
  } catch (error: unknown) {
    return apiError(error, "自动更新汇率失败");
  }
}
