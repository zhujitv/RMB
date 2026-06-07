import { apiError, deleteLogisticsCost, getActor, ok, saveLogisticsCost } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await request.json();
    const cost = await saveLogisticsCost(request, actor, body, id);
    return ok({ success: true, cost, message: "物流费用已保存" });
  } catch (error) {
    return apiError(error, "更新物流费用失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    await deleteLogisticsCost(request, actor, id);
    return ok({ success: true, ok: true, message: "物流费用已删除" });
  } catch (error) {
    return apiError(error, "删除物流费用失败");
  }
}
