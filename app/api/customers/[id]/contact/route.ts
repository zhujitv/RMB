import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, updateCustomerContactInfo } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const customer = await updateCustomerContactInfo(request, actor, id, body);
    return ok({
      success: true,
      data: customer,
      customer,
      message: "联系人资料已保存",
    });
  } catch (error: unknown) {
    return apiError(error, "联系人资料保存失败");
  }
}
