import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, uploadSupplierDocumentRequestDocument } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const formData = await request.formData();
    const result = await uploadSupplierDocumentRequestDocument(request, actor, id, {
      documentType: String(formData.get("documentType") || ""),
      file: formData.get("file"),
    });
    return NextResponse.json({
      success: true,
      request: result.request,
      document: result.document,
      data: result,
      message: "资料已上传",
    });
  } catch (error: unknown) {
    return apiError(error, "上传供应商回传资料失败");
  }
}
