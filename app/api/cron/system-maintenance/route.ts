import type { NextRequest } from "next/server";
import {
  apiError,
  assertCronSecret,
  cleanupExpiredAuditLogs,
  ok,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const auditLogs = await cleanupExpiredAuditLogs();
    return ok({ auditLogs });
  } catch (error: unknown) {
    return apiError(error, "执行系统数据清理失败");
  }
}
