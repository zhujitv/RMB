import { NextResponse, type NextRequest } from "next/server";
import { apiError, deleteSupplierDocumentRequest } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const result = await deleteSupplierDocumentRequest(request, actor, id);
    return NextResponse.json({
      success: true,
      ...result,
      message: "已删除资料回传任务",
    });
  } catch (error: unknown) {
    return apiError(error, "删除资料回传任务失败");
  }
}
