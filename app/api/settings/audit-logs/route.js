import { apiError, assertRead, getActor, getAuditLogs, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    assertRead(actor, "auditLogs");
    const query = new URL(request.url).searchParams;
    const page = await getAuditLogs(query, { actor, paginated: true, defaultPageSize: 50 });
    return ok({
      logs: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    });
  } catch (error) {
    return apiError(error, "读取操作日志失败");
  }
}
