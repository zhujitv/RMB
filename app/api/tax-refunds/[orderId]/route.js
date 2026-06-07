import { apiError, cancelTaxRefundArchive, getActor, getTaxRefundOrderDetail, ok, requireText, updateTaxRefundStatus } from "../../../../lib/platform-db";

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
    const status = requireText(body.status, "退税状态");
    const order = await updateTaxRefundStatus(request, actor, orderId, status, body);
    return ok({ success: true, order, message: status === "SUBMITTED" ? "退税资料已提交并归档" : "退税状态已更新" });
  } catch (error) {
    return apiError(error, "更新退税状态失败");
  }
}
