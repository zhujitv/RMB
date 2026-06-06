import { apiError, deleteLogisticsCost, getActor, ok, saveLogisticsCost } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await request.json();
    return ok({ cost: await saveLogisticsCost(request, actor, body, id) });
  } catch (error) {
    return apiError(error, "更新物流费用失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    await deleteLogisticsCost(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除物流费用失败");
  }
}
