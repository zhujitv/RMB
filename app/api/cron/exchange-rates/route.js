import { apiError, assertCronSecret, getCronActor, ok, refreshExchangeRatesForDate, writeAudit } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertCronSecret(request);
    const actor = await getCronActor();
    if (!actor) {
      const error = new Error("没有可用于执行定时任务的管理员账号");
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
    ).catch((error) => console.error("自动汇率操作日志写入失败", error));
    return ok(result);
  } catch (error) {
    return apiError(error, "自动更新汇率失败");
  }
}
