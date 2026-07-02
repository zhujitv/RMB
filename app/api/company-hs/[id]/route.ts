import { type NextRequest } from "next/server";
import { apiError, disableCompanyHs, ok, parseJsonBody, saveCompanyHs } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request) as Record<string, unknown>;
    return ok({ success: true, item: await saveCompanyHs(request, actor, body, id), message: "企业HS编码已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存企业HS编码失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    return ok({ success: true, item: await disableCompanyHs(request, actor, id), message: "企业HS编码已停用" });
  } catch (error: unknown) {
    return apiError(error, "停用企业HS编码失败");
  }
}
