import { apiError, getActor } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  try {
    await params;
    await getActor(request);
    return Response.json({ error: "旧附件接口已停用，请使用订单单证 R2 上传接口。" }, { status: 410 });
  } catch (error) {
    return apiError(error, "删除附件失败");
  }
}
