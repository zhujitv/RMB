import type { NextRequest } from "next/server";
import { apiError, assertCronSecret, ok, runPendingSupplierDocumentOcrTasks } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const limit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "", 10);
    const minAgeMs = Number.parseInt(request.nextUrl.searchParams.get("minAgeMs") || "", 10);
    const result = await runPendingSupplierDocumentOcrTasks(limit || 5, minAgeMs || 60_000);
    return ok(result);
  } catch (error: unknown) {
    return apiError(error, "执行供应商资料 OCR 后台任务失败");
  }
}
