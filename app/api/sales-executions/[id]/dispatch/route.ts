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
    const sms = result.smsNotificationSummary;
    const emailParts = [
      sent ? `门户邮件成功 ${sent} 封` : "",
      failed ? `门户邮件失败 ${failed} 封` : "",
      queued ? `门户邮件待自动重试 ${queued} 封` : "",
      missingRecipient ? `${missingRecipient} 家工厂无门户收件人、按线下协同` : "",
    ].filter(Boolean);
    const smsParts = [
      sms.submitted ? `腾讯云已受理 ${sms.submitted} 条` : "",
      sms.failed ? `失败 ${sms.failed} 条` : "",
      sms.unknown ? `发送结果未知 ${sms.unknown} 条，已停止自动重试` : "",
      sms.queued ? `待自动处理 ${sms.queued} 条` : "",
      sms.configurationError ? `设置异常 ${sms.configurationError} 家` : "",
      sms.missingRecipient ? `无有效手机号 ${sms.missingRecipient} 家` : "",
    ].filter(Boolean);
    const deliveryParts = [
      ...emailParts,
      ...(smsParts.length ? [`供应商短信：${smsParts.join("，")}`] : []),
    ];
    const deliveryMessage = deliveryParts.length ? `；${deliveryParts.join("；")}` : "";
    return NextResponse.json({
      success: true,
      data: result.execution,
      execution: result.execution,
      notificationSummary: result.notificationSummary,
      smsNotificationSummary: result.smsNotificationSummary,
      message: result.newlyDispatched
        ? `销售执行单已正式下发并锁定${deliveryMessage}`
        : `销售执行单已经下发${deliveryMessage || "，无需重复操作"}`,
    });
  } catch (error: unknown) {
    return apiError(error, "正式下发销售执行单失败");
  }
}
