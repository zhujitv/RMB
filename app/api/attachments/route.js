import { apiError, assertWrite, getActor, ok, optional, requireText, writeAudit } from "../../../lib/platform-db";
import { prisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await getActor(request);
    const query = new URL(request.url).searchParams;
    const relatedType = query.get("relatedType") || undefined;
    const relatedId = query.get("relatedId") || undefined;
    const rows = await prisma.attachment.findMany({
      where: { deletedAt: null, relatedType, relatedId },
      include: { uploadedBy: true },
      orderBy: [{ createdAt: "desc" }],
    });
    return ok({ attachments: rows });
  } catch (error) {
    return apiError(error, "读取附件失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    assertWrite(actor, "attachments");
    const body = await request.json();
    const row = await prisma.attachment.create({
      data: {
        relatedType: requireText(body.relatedType, "关联类型"),
        relatedId: requireText(body.relatedId, "关联 ID"),
        fileName: requireText(body.fileName, "文件名"),
        fileUrl: requireText(body.fileUrl, "文件地址"),
        fileSize: body.fileSize ? Number(body.fileSize) : null,
        mimeType: optional(body.mimeType),
        uploadedById: actor.id,
      },
    });
    await writeAudit(request, actor, "新增附件", "attachments", row.id, null, row);
    return ok({ attachment: row });
  } catch (error) {
    return apiError(error, "保存附件失败");
  }
}
