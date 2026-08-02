import type { NextRequest } from "next/server";
import {
  apiError,
  assertCronSecret,
  getCronActor,
  logServerError,
  ok,
  processFileStorageDeletionOutbox,
  processFailedFreightowerNotificationOutbox,
  processLogisticsInvoiceNotificationOutbox,
  processWechatOfficialNotificationOutbox,
  writeAudit,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const [notifications, trackingNotifications, wechatNotifications, fileDeletions] = await Promise.all([
      processLogisticsInvoiceNotificationOutbox({ limit: 8 }),
      processFailedFreightowerNotificationOutbox({ limit: 8 }),
      processWechatOfficialNotificationOutbox({ limit: 8 }),
      processFileStorageDeletionOutbox(20),
    ]);
    const result = { notifications, trackingNotifications, wechatNotifications, fileDeletions };
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
