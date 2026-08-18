import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, deleteVoidedSalesExecution, parseJsonBody } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const result = await deleteVoidedSalesExecution(request, actor, id, await parseJsonBody(request));
    return NextResponse.json({
      success: true,
      data: result,
      message: result.cleanupPending
        ? "销售执行数据已永久删除，附件正在后台清理"
        : "销售执行及关联采购数据已永久删除",
    });
  } catch (error: unknown) {
    return apiError(error, "删除销售执行失败");
  }
}
