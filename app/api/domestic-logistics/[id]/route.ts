import type { NextRequest } from "next/server";
import { apiError, deleteDomesticLogisticsInfo, getActor, ok, parseJsonBody, saveDomesticLogisticsInfo } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const saveDomesticLogisticsInfoTyped = saveDomesticLogisticsInfo as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const info = await saveDomesticLogisticsInfoTyped(request, actor, body, id);
    return ok({ success: true, info, message: "物流信息已更新" });
  } catch (error: unknown) {
    return apiError(error, "更新物流信息失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    await deleteDomesticLogisticsInfo(request, actor, id);
    return ok({ success: true, message: "物流信息已删除" });
  } catch (error: unknown) {
    return apiError(error, "删除物流信息失败");
  }
}
