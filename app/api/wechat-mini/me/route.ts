import type { NextRequest } from "next/server";
import { apiError, getWechatMiniSubscriptionStatus, ok, requireWechatMiniActor } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireWechatMiniActor(request);
    const subscription = await getWechatMiniSubscriptionStatus(actor);
    return ok({
      success: true,
      user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role },
      subscription,
    });
  } catch (error: unknown) {
    return apiError(error, "读取小程序账号失败");
  }
}
