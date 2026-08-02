import type { NextRequest } from "next/server";
import {
  apiError,
  getWechatMiniSubscriptionStatus,
  ok,
  parseJsonBody,
  recordWechatMiniSubscriptionGrant,
  requireWechatMiniActor,
} from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireWechatMiniActor(request);
    return ok({ success: true, subscription: await getWechatMiniSubscriptionStatus(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取小程序订阅状态失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireWechatMiniActor(request);
    const body = await parseJsonBody(request) as Record<string, unknown>;
    return ok({ success: true, subscription: await recordWechatMiniSubscriptionGrant(actor, body) });
  } catch (error: unknown) {
    return apiError(error, "保存小程序订阅授权失败");
  }
}
