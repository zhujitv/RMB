import type { NextRequest } from "next/server";
import { apiError, assertCronSecret, getCronActor, logServerError, ok, writeAudit } from "../../../../lib/platform-db";
import { sendOverdueWorkbenchTodoReminders } from "../../../../lib/platform/workbench-todo-reminders";

export const dynamic = "force-dynamic";

type ErrorWithStatus = Error & {
  status?: number;
};

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const actor = await getCronActor();
    if (!actor) {
      const error: ErrorWithStatus = new Error("没有可用于执行待办逾期提醒任务的管理员账号");
      error.status = 500;
      throw error;
    }
    const result = await sendOverdueWorkbenchTodoReminders(actor);
    writeAudit(request, actor, "执行待办逾期邮件提醒", "todo_reminder_logs", "cron", null, result)
      .catch((error: unknown) => logServerError("待办逾期提醒操作日志写入失败", error, {
        scanned: result.scanned,
        eligible: result.eligible,
        sent: result.sent,
        failed: result.failed,
      }));
    return ok(result);
  } catch (error: unknown) {
    return apiError(error, "执行待办逾期提醒失败");
  }
}
