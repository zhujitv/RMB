import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../../lib/platform-db";
import { retryFactoryPurchaseOrderDispatchEmail } from "../../../../../../../../lib/platform/factory-purchase-order-dispatch-retry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, purchaseOrderId } = await params;
    const body = await parseJsonBody(request);
    const result = await retryFactoryPurchaseOrderDispatchEmail(request, actor, id, purchaseOrderId, body);
    const summary = result.notificationSummary;
    const message = summary.missingRecipient
      ? `${result.blockedReason || "供应商未配置有效邮箱"}，请先修正供应商资料`
      : `已重新提交邮件：成功 ${summary.sent} 封${summary.failed ? `，失败 ${summary.failed} 封` : ""}${summary.queued ? `，待自动重试 ${summary.queued} 封` : ""}`;
    return NextResponse.json({
      success: true,
      data: result.execution,
      execution: result.execution,
      notificationSummary: summary,
      message,
    });
  } catch (error: unknown) {
    return apiError(error, "重试工厂采购单邮件失败");
  }
}
