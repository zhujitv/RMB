import { apiError, getActor, listUsers, ok, saveUser } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ users: await listUsers(actor) });
  } catch (error) {
    return apiError(error, "读取用户失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const user = await saveUser(request, actor, body);
    return ok({ success: true, user, message: "用户已保存" }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存用户失败");
  }
}
