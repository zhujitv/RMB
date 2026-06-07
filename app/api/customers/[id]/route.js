import { apiError, deleteCustomer, getActor, ok, saveCustomer } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    const customer = await saveCustomer(request, actor, body, id);
    return ok({
      success: true,
      data: customer,
      message: "客户资料已保存",
    });
  } catch (error) {
    return apiError(error, "更新客户失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteCustomer(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除客户失败");
  }
}
