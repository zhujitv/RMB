import { apiError, getActor, getReminders, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const reminders = await getReminders(new URL(request.url).searchParams, actor);
    return ok({ count: reminders.length, reminders });
  } catch (error) {
    return apiError(error, "执行催款提醒失败");
  }
}
