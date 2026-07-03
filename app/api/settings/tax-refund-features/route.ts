import { type NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, readTaxRefundFeatureSettings, saveTaxRefundFeatureSettings } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ settings: await readTaxRefundFeatureSettings(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取企业HS编码设置失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const settings = await saveTaxRefundFeatureSettings(request, actor, body);
    return ok({ success: true, settings, message: "企业HS编码设置已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存企业HS编码设置失败");
  }
}
