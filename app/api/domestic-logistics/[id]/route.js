import { apiError, deleteDomesticLogisticsInfo, getActor, ok, reviewDomesticLogisticsInfo, saveDomesticLogisticsInfo, unlockDomesticLogisticsInfo } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await request.json();
    const info = body.action === "unlock"
      ? await unlockDomesticLogisticsInfo(request, actor, id, body)
      : (body.action === "review" || body.financeStatus || body.status
        ? await reviewDomesticLogisticsInfo(request, actor, id, body)
        : await saveDomesticLogisticsInfo(request, actor, body, id));
    return ok({ success: true, info, message: "国内物流信息已更新" });
  } catch (error) {
    return apiError(error, "更新国内物流信息失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    await deleteDomesticLogisticsInfo(request, actor, id);
    return ok({ success: true, message: "国内物流信息已删除" });
  } catch (error) {
    return apiError(error, "删除国内物流信息失败");
  }
}
