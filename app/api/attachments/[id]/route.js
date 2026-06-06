import { apiError, deleteAttachment, getActor, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteAttachment(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除附件失败");
  }
}
