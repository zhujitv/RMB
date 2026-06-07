import { apiError, deleteCost, getActor, ok, saveCost } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ success: true, cost: await saveCost(request, actor, body, id) });
  } catch (error) {
    return apiError(error, "更新成本失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteCost(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除成本失败");
  }
}
