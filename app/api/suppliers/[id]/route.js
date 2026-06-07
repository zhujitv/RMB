import { apiError, deleteSupplier, getActor, ok, saveSupplier } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    const supplier = await saveSupplier(request, actor, body, id);
    return ok({ success: true, supplier, message: "供应商已保存" });
  } catch (error) {
    return apiError(error, "更新供应商失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteSupplier(request, actor, id);
    return ok({ success: true, ok: true, message: "供应商已删除" });
  } catch (error) {
    return apiError(error, "删除供应商失败");
  }
}
