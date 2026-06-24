import type { NextRequest } from "next/server";
import { apiError, getActor, ok, parseJsonBody, readCompanyProfileSettings, saveCompanyProfileSettings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return ok({ settings: await readCompanyProfileSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取公司资料失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveCompanyProfileSettings(request, actor, body);
    return ok({ success: true, settings, message: "公司资料已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存公司资料失败");
  }
}
