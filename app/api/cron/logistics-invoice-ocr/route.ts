import type { NextRequest } from "next/server";
import {
  apiError,
  assertCronSecret,
  getCronActor,
  logServerError,
  ok,
  runPendingLogisticsInvoiceOcrTasks,
  writeAudit,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const result = await runPendingLogisticsInvoiceOcrTasks(5);
    const actor = await getCronActor();
    if (actor) {
      void writeAudit(
        request,
        actor,
        "执行物流发票后台识别",
        "ocr_tasks",
        "logistics-invoice-cron",
        null,
        result,
      ).catch((error: unknown) => logServerError("物流发票后台识别日志写入失败", error, result));
    }
    return ok(result);
  } catch (error: unknown) {
    return apiError(error, "执行物流发票后台识别失败");
  }
}
