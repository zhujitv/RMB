import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  deleteQuotationDraft,
  parseJsonBody,
} from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const result = await deleteQuotationDraft(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: result,
      message: result.cleanupPending
        ? "报价数据已删除，形式发票文件正在后台继续清理"
        : "报价及已生成的形式发票已永久删除",
    });
  } catch (error: unknown) {
    return apiError(error, "删除报价失败");
  }
}
