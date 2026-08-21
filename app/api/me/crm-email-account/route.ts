import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  parseJsonBody,
  readOwnCrmEmailAccount,
  saveOwnCrmEmailAccount,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok(await readOwnCrmEmailAccount(actor));
  } catch (error: unknown) {
    return apiError(error, "读取个人系统邮箱失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await saveOwnCrmEmailAccount(request, actor, body);
    return ok({ success: true, ...result, message: "个人系统邮箱已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存个人系统邮箱失败");
  }
}
