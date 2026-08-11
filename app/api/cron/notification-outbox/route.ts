import type { NextRequest } from "next/server";
import {
  apiError,
  assertCronSecret,
  getCronActor,
  logServerError,
  ok,
  processFileStorageDeletionOutbox,
  processFailedFreightowerNotificationOutbox,
  processPendingFreightowerTrackingNotifications,
  processLogisticsInvoiceNotificationOutbox,
  writeAudit,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    // Establish durable tracking outbox rows first. This avoids racing the stale
    // email retry worker against the same notification key in this cron run.
    const pendingTrackingNotifications = await processPendingFreightowerTrackingNotifications({ limit: 8 })
      .catch((error: unknown) => ({
        scanned: 0,
        processed: 0,
        deferred: 0,
        failed: 1,
        results: [],
        error: error instanceof Error ? error.message : "物流待通知队列读取失败",
      }));
    const [notifications, trackingNotifications, fileDeletions] = await Promise.all([
      processLogisticsInvoiceNotificationOutbox({ limit: 8 }),
      processFailedFreightowerNotificationOutbox({ limit: 8 }),
      processFileStorageDeletionOutbox(20),
    ]);
    const result = { notifications, pendingTrackingNotifications, trackingNotifications, fileDeletions };
    const actor = await getCronActor();
    if (actor) {
      void writeAudit(
        request,
        actor,
        "执行通知与文件清理队列",
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
