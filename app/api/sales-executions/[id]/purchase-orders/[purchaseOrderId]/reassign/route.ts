import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { reassignRejectedFactoryPurchaseOrder } from "../../../../../../../lib/platform/factory-purchase-order-reassignment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const result = await reassignRejectedFactoryPurchaseOrder(
      request,
      actor,
      id,
      purchaseOrderId,
      await parseJsonBody(request),
    );
    const sms = result.smsNotificationSummary;
    const smsParts = [
      sms.submitted ? `腾讯云已受理 ${sms.submitted} 条` : "",
      sms.failed ? `失败 ${sms.failed} 条` : "",
      sms.unknown ? `发送结果未知 ${sms.unknown} 条，已停止自动重试` : "",
      sms.queued ? `待处理 ${sms.queued} 条` : "",
      sms.configurationError ? "短信设置异常" : "",
      sms.missingRecipient ? "供应商未配置有效手机号" : "",
    ].filter(Boolean);
    return NextResponse.json({
      success: true,
      data: result.execution,
      ...result,
      message: `已重新选择工厂并单独下发新采购单${smsParts.length ? `；供应商短信：${smsParts.join("，")}` : ""}`,
    });
  } catch (error: unknown) {
    return apiError(error, "重新选择工厂并下发采购单失败");
  }
}
