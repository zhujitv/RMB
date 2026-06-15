import { apiError, deleteDomesticLogisticsInfo, getActor, ok, saveDomesticLogisticsInfo } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await request.json();
    const info = await saveDomesticLogisticsInfo(request, actor, body, id);
    return ok({ success: true, info, message: "物流信息已更新" });
  } catch (error) {
    return apiError(error, "更新物流信息失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    await deleteDomesticLogisticsInfo(request, actor, id);
    return ok({ success: true, message: "物流信息已删除" });
  } catch (error) {
    return apiError(error, "删除物流信息失败");
  }
}
