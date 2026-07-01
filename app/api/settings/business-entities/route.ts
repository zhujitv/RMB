import type { NextRequest } from "next/server";
import {
  apiError,
  codedError,
  createBusinessEntitySetting,
  listBusinessEntitySettings,
  ok,
  parseJsonBody,
  updateBusinessEntitySetting,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const entities = await listBusinessEntitySettings(actor);
    return ok({ success: true, entities });
  } catch (error: unknown) {
    return apiError(error, "读取业务主体设置失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const entity = await createBusinessEntitySetting(request, actor, body);
    return ok({ success: true, entity, message: "业务主体已新增" });
  } catch (error: unknown) {
    return apiError(error, "新增业务主体失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const id = String(body.id || "").trim();
    if (!id) throw codedError("缺少业务主体 ID", 400, "BUSINESS_ENTITY_ID_REQUIRED");
    const entity = await updateBusinessEntitySetting(request, actor, id, body);
    return ok({ success: true, entity, message: "业务主体已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存业务主体失败");
  }
}
