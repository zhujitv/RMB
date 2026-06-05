import { apiError, deleteSupplier, getActor, ok, saveSupplier } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ supplier: await saveSupplier(request, actor, body, id) });
  } catch (error) {
    return apiError(error, "更新供应商失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteSupplier(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除供应商失败");
  }
}
