import { apiError, getActor, listOrderDocuments, MAX_PDF_UPLOAD_BYTES, ok, requireText, uploadOrderDocument } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ documents: await listOrderDocuments(query, actor) });
  } catch (error) {
    return apiError(error, "读取订单单证失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file.arrayBuffer !== "function") {
      const error = new Error("请选择 PDF 文件");
      error.status = 400;
      throw error;
    }
    const fileName = String(file.name || "");
    if (!fileName.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
      const error = new Error("文件类型不允许，只能上传 PDF 文件");
      error.status = 400;
      error.code = "FILE_TYPE_NOT_ALLOWED";
      throw error;
    }
    if (Number(file.size || 0) > MAX_PDF_UPLOAD_BYTES) {
      const error = new Error("文件超过大小限制，最大支持 20MB PDF。");
      error.status = 413;
      error.code = "FILE_TOO_LARGE";
      throw error;
    }
    const document = await uploadOrderDocument(request, actor, {
      orderId: requireText(formData.get("orderId"), "订单"),
      documentType: requireText(formData.get("documentType"), "单证类型"),
      costId: String(formData.get("costId") || ""),
      supplierId: String(formData.get("supplierId") || ""),
      file,
    });
    return ok({ document });
  } catch (error) {
    return apiError(error, "上传订单单证失败");
  }
}
