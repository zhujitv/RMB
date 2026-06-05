import { apiError, deleteOrder, getActor, getOrder, ok, saveOrder } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    return ok({ order: await getOrder(id, actor) });
  } catch (error) {
    return apiError(error, "读取应收订单失败");
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ order: await saveOrder(request, actor, body, id) });
  } catch (error) {
    return apiError(error, "更新应收订单失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteOrder(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除应收订单失败");
  }
}
