import type { NextRequest } from "next/server";
import {
  apiError,
  assertCronSecret,
  ok,
  runPendingLogisticsInvoiceOcrTasks,
  runPendingSupplierDocumentOcrTasks,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "", 10);
    const minAgeMs = Number.parseInt(request.nextUrl.searchParams.get("minAgeMs") || "", 10);
    const supplier = await runPendingSupplierDocumentOcrTasks(limit || 5, minAgeMs || 60_000);
    const logistics = await runPendingLogisticsInvoiceOcrTasks(limit || 5, minAgeMs || 60_000).catch((error) => {
      const message = error instanceof Error ? error.message : String(error || "物流发票 OCR 后台任务失败");
      console.error("logistics-invoice-ocr-cron-failed", { message });
      return {
        scanned: 0,
        processed: 0,
        failed: 1,
        skipped: 0,
        taskIds: [],
        error: message,
      };
    });
    return ok({ supplier, logistics });
  } catch (error: unknown) {
    return apiError(error, "执行 OCR 后台任务失败");
  }
}
