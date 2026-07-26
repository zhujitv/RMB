import { NextResponse, type NextRequest } from "next/server";
import { apiError, uploadSupplierDocumentRequestDocument } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";
import { assertMultipartRequestWithinLimit } from "../../../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    assertMultipartRequestWithinLimit(request);
    const formData = await request.formData();
    const result = await uploadSupplierDocumentRequestDocument(request, actor, id, {
      documentType: String(formData.get("documentType") || ""),
      costId: String(formData.get("costId") || ""),
      file: formData.get("file"),
    });
    return NextResponse.json({
      success: true,
      request: result.request,
      document: result.document,
      data: result,
      message: "上传成功",
    });
  } catch (error: unknown) {
    return apiError(error, "上传供应商回传资料失败");
  }
}
