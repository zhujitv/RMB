import { apiError, cancelTaxRefundArchive, getActor, getTaxRefundOrderDetail, ok, previewCustomsRecognition, reparseCustomsRecognition, requireText, updateCustomsRecognition, updateTaxRefundStatus } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const actor = await getActor(request);
    const { orderId } = await params;
    return ok({ order: await getTaxRefundOrderDetail(orderId, actor) });
  } catch (error) {
    return apiError(error, "读取退税资料详情失败");
  }
}

export async function PATCH(request, { params }) {
  try {
    const actor = await getActor(request);
    const { orderId } = await params;
    const body = await request.json();
    if (body.cancelArchive === true) {
      const order = await cancelTaxRefundArchive(request, actor, orderId, body.status || "NOT_READY", body);
      return ok({ success: true, order, message: "退税资料已取消归档" });
    }
    if (body.action === "updateCustomsRecognition") {
      const order = await updateCustomsRecognition(request, actor, orderId, body);
      return ok({ success: true, order, message: "报关单信息已保存" });
    }
    if (body.action === "previewCustomsRecognition") {
      const result = await previewCustomsRecognition(actor, orderId);
      return ok({ success: true, data: result, message: "报关单识别结果已生成" });
    }
    if (body.action === "reparseCustomsRecognition") {
      const order = await reparseCustomsRecognition(request, actor, orderId, body);
      return ok({ success: true, order, message: "报关单信息已重新识别" });
    }
    const status = requireText(body.status, "退税状态");
    const order = await updateTaxRefundStatus(request, actor, orderId, status, body);
    return ok({ success: true, order, message: status === "SUBMITTED" ? "退税资料已提交并归档" : "退税状态已更新" });
  } catch (error) {
    return apiError(error, "更新退税状态失败");
  }
}
