import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseJsonBody, rejectSupplierDocumentOcr } from "../../../../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id, documentId } = await params;
    const body = await parseJsonBody(request, { allowEmpty: true });
    const ocrTask = await rejectSupplierDocumentOcr(request, actor, id, documentId, body);
    return NextResponse.json({
      success: true,
      ocrTask,
      data: ocrTask,
      message: "已驳回重传",
    });
  } catch (error: unknown) {
    return apiError(error, "驳回供应商回传资料失败");
  }
}
