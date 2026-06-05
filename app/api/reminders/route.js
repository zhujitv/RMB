import { apiError, getActor, getReminders, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ reminders: await getReminders(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取催款提醒失败");
  }
}
