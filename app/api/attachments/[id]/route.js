import { apiError, assertWrite, getActor, ok, writeAudit } from "../../../../lib/platform-db";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    assertWrite(actor, "attachments");
    const before = await prisma.attachment.findUnique({ where: { id } });
    const row = await prisma.attachment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await writeAudit(request, actor, "删除附件", "attachments", id, before, row);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除附件失败");
  }
}
