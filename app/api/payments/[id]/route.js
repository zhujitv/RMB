import { apiError, deletePayment, getActor, ok, savePayment } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    const payment = await savePayment(request, actor, body, id);
    return ok({ success: true, payment, message: "收款已保存" });
  } catch (error) {
    return apiError(error, "更新收款失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deletePayment(request, actor, id);
    return ok({ success: true, ok: true, message: "收款已删除" });
  } catch (error) {
    return apiError(error, "删除收款失败");
  }
}
