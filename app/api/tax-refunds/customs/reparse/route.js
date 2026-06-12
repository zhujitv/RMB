import { apiError, getActor, ok, previewCustomsRecognition, requireText } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const orderId = requireText(body.orderId, "订单ID");
    const documentId = requireText(body.documentId, "报关单文件ID");
    const documentType = String(body.documentType || "CUSTOMS_ENTRY_FORM");
    if (!["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION", "报关单"].includes(documentType)) {
      const error = new Error("仅支持报关单 PDF 识别");
      error.status = 400;
      error.code = "INVALID_DOCUMENT_TYPE";
      throw error;
    }

    const result = await previewCustomsRecognition(actor, orderId, {
      documentId,
      documentType,
    });

    return ok({
      success: true,
      data: {
        orderId: result.orderId,
        documentId: result.documentId || documentId,
        customsDeclarationNo: result.customsDeclarationNo || "",
        customsDeclarationDate: result.customsDeclarationDate || "",
        customsParsedAt: new Date().toISOString(),
        customsParseStatus: result.status || "FAILED",
        customsParseMessage: result.message || "",
        source: result.source || "",
      },
      message: "报关单识别结果已生成",
    });
  } catch (error) {
    return apiError(error, "重新识别报关单失败");
  }
}
