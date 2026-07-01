import { NextResponse, type NextRequest } from "next/server";
import { apiError, confirmSupplierDocumentOcr } from "../../../../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id, documentId } = await params;
    const ocrTask = await confirmSupplierDocumentOcr(request, actor, id, documentId);
    return NextResponse.json({
      success: true,
      ocrTask,
      data: ocrTask,
      message: "已人工确认通过",
    });
  } catch (error: unknown) {
    return apiError(error, "人工确认供应商回传资料失败");
  }
}
