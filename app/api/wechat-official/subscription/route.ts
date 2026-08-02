import type { NextRequest } from "next/server";
import { apiError, createWechatSubscriptionAuthorization, ok, readOwnWechatSubscriptionStatus, unlinkOwnWechatOfficialAccount } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ success: true, status: await readOwnWechatSubscriptionStatus(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取微信通知状态失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ success: true, ...(await createWechatSubscriptionAuthorization(actor)) });
  } catch (error: unknown) {
    return apiError(error, "创建微信订阅授权失败");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok(await unlinkOwnWechatOfficialAccount(actor));
  } catch (error: unknown) {
    return apiError(error, "停止微信通知失败");
  }
}
