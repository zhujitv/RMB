import { NextResponse, type NextRequest } from "next/server";
import { apiError, rerunSupplierDocumentOcr } from "../../../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id, documentId } = await params;
    const ocrTask = await rerunSupplierDocumentOcr(request, actor, id, documentId);
    return NextResponse.json({
      success: true,
      ocrTask,
      data: ocrTask,
      message: "已提交重新识别，OCR正在后台处理",
    });
  } catch (error: unknown) {
    return apiError(error, "重新识别供应商回传资料失败");
  }
}
