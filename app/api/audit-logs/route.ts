import type { NextRequest } from "next/server";
import { apiError, assertRead, getAuditLogs, ok } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertRead(actor, "auditLogs");
    return ok({ logs: await getAuditLogs(new URL(request.url).searchParams, { actor }) });
  } catch (error: unknown) {
    return apiError(error, "读取操作日志失败");
  }
}
