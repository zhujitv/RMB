import { NextResponse, type NextRequest } from "next/server";
import { apiError, rerunSupplierDocumentOcr, supplierDocumentOcrApiResult } from "../../../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id, documentId } = await params;
    const ocrTask = await rerunSupplierDocumentOcr(request, actor, id, documentId);
    const ocrResult = supplierDocumentOcrApiResult(ocrTask);
    return NextResponse.json({
      success: true,
      ...ocrResult,
      ocrTask,
      data: ocrTask,
    });
  } catch (error: unknown) {
    return apiError(error, "重新识别供应商回传资料失败");
  }
}
