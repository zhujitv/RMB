import { apiError, ok, registerUser } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    return ok({ user: await registerUser(request, body), message: "注册申请已提交，请等待管理员审核。" });
  } catch (error) {
    return apiError(error, "提交注册申请失败");
  }
}
