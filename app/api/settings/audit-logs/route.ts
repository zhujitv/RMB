import type { NextRequest } from "next/server";
import { apiError, assertRead, getAuditLogs, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

const getAuditLogsTyped = getAuditLogs as (
  query: URLSearchParams,
  options: { actor: unknown; paginated: true; defaultPageSize: number },
) => Promise<{
  rows: unknown[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}>;

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertRead(actor, "auditLogs");
    const query = new URL(request.url).searchParams;
    const page = await getAuditLogsTyped(query, { actor, paginated: true, defaultPageSize: 50 });
    return ok({
      logs: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取操作日志失败");
  }
}
