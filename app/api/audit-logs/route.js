import { apiError, getActor, getAuditLogs, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    if (!["管理员", "查看者"].includes(actor.role)) {
      return ok({ logs: [] });
    }
    return ok({ logs: await getAuditLogs(new URL(request.url).searchParams) });
  } catch (error) {
    return apiError(error, "读取操作日志失败");
  }
}
