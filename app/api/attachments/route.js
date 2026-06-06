import { apiError, getActor } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await getActor(request);
    return Response.json({ error: "旧附件接口已停用，请使用订单单证 R2 上传接口。" }, { status: 410 });
  } catch (error) {
    return apiError(error, "读取附件失败");
  }
}

export async function POST(request) {
  try {
    await getActor(request);
    return Response.json({ error: "旧附件接口已停用，请使用订单单证 R2 上传接口。" }, { status: 410 });
  } catch (error) {
    return apiError(error, "保存附件失败");
  }
}
