import type { NextRequest } from "next/server";
import { apiError } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    await params;
    await requireApiActor(request);
    return Response.json({ error: "旧附件接口已停用，请使用订单单证 R2 上传接口。" }, { status: 410 });
  } catch (error: unknown) {
    return apiError(error, "删除附件失败");
  }
}
