import { apiError, deletePayment, getActor, ok, savePayment } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ payment: await savePayment(request, actor, body, id) });
  } catch (error) {
    return apiError(error, "更新收款失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deletePayment(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除收款失败");
  }
}
