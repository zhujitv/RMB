import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { dispatchSalesExecution } from "../../../../../lib/platform/sales-execution-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const result = await dispatchSalesExecution(request, actor, id, body);
    const { sent, failed, queued, missingRecipient } = result.notificationSummary;
    const deliveryMessage = result.newlyDispatched
      ? `；邮件成功 ${sent} 封${failed ? `，失败 ${failed} 封` : ""}${queued ? `，待自动重试 ${queued} 封` : ""}${missingRecipient ? `，${missingRecipient} 家工厂未配置邮箱` : ""}`
      : "";
    return NextResponse.json({
      success: true,
      data: result.execution,
      execution: result.execution,
      notificationSummary: result.notificationSummary,
      message: result.newlyDispatched
        ? `销售执行单已正式下发并锁定${deliveryMessage}`
        : "销售执行单已经下发，无需重复操作",
    });
  } catch (error: unknown) {
    return apiError(error, "正式下发销售执行单失败");
  }
}
