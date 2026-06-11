import { NextResponse } from "next/server";
import { apiError, getActor, uploadLogisticsSupplierExpenseDocument } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    const logisticsDocumentType = String(formData.get("logisticsDocumentType") || "发票").trim();
    if (!file || typeof file.arrayBuffer !== "function") {
      const error = new Error("请选择 PDF 文件");
      error.status = 400;
      error.code = "FILE_REQUIRED";
      throw error;
    }
    const document = await uploadLogisticsSupplierExpenseDocument(request, actor, id, { file, logisticsDocumentType });
    return NextResponse.json({ success: true, document, data: document, message: "附件上传成功" });
  } catch (error) {
    return apiError(error, "上传物流费用附件失败");
  }
}
