import type { NextRequest } from "next/server";
import { apiError, assertCronSecret, getCronActor, getReminders, logServerError, ok, writeAudit } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type ErrorWithStatus = Error & {
  status?: number;
};

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const actor = await getCronActor();
    if (!actor) {
      const error: ErrorWithStatus = new Error("没有可用于执行定时任务的管理员账号");
      error.status = 500;
      throw error;
    }
    const reminders = await getReminders(new URL(request.url).searchParams, actor);
    writeAudit(request, actor, "执行催款提醒任务", "reminders", "cron", null, {
      count: reminders.length,
    }).catch((error: unknown) => logServerError("催款提醒操作日志写入失败", error, { count: reminders.length }));
    return ok({ count: reminders.length, reminders });
  } catch (error: unknown) {
    return apiError(error, "执行催款提醒失败");
  }
}
