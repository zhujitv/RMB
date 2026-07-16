import type { NextRequest } from "next/server";
import {
  apiError,
  assertCronSecret,
  getCronActor,
  logServerError,
  ok,
  processLogisticsInvoiceNotificationOutbox,
  writeAudit,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const result = await processLogisticsInvoiceNotificationOutbox({ limit: 8 });
    const actor = await getCronActor();
    if (actor) {
      void writeAudit(
        request,
        actor,
        "执行物流开票通知队列",
        "notification_outbox",
        "logistics-invoice-cron",
        null,
        result,
      ).catch((error: unknown) => logServerError("物流开票通知队列日志写入失败", error, result));
    }
    return ok(result);
  } catch (error: unknown) {
    return apiError(error, "执行物流开票通知队列失败");
  }
}
