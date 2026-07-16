import type { NextRequest } from "next/server";
import {
  apiError,
  codedError,
  confirmLogisticsExpenseInvoice,
  logServerError,
  manuallyConfirmLogisticsInvoiceValidation,
  ok,
  parseJsonBody,
  resendLogisticsExpenseInvoiceNotice,
  rerunLogisticsExpenseInvoiceRecognition,
  reverseLogisticsExpensePayment,
  reviewLogisticsExpense,
  submitLogisticsExpenseBill,
  updateLogisticsExpense,
  updateLogisticsExpensePaymentStatus,
  voidLogisticsExpenseBill,
  withdrawLogisticsExpenseBill,
} from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type LogisticsExpenseBody = Record<string, unknown> & {
  action?: string;
  reviewAction?: string;
  auditAction?: string;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  let requestAction = "";
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request) as LogisticsExpenseBody;
    requestAction = String(body.action || body.reviewAction || body.auditAction || "");
    const reviewAction = body.action || body.reviewAction || body.auditAction || "";
    if (["approve", "reject", "reopen"].includes(reviewAction)) {
      const result = await reviewLogisticsExpense(request, actor, id, body);
	      const message = reviewAction === "reject"
	        ? "物流费用账单已驳回"
	        : result.emailError
	          ? "物流费用已审核并同步成本，开票通知发送失败，可稍后重发"
	          : result.emailNotified
	            ? "物流费用已审核，已通知供应商上传发票"
	            : "物流费用已审核，已同步成本管理";
      return ok({ success: true, ...result, message });
    }
    if ((body.action || "") === "submitBill" || (body.action || "") === "submit") {
      const result = await submitLogisticsExpenseBill(request, actor, id);
      return ok({ success: true, ...result, message: "物流费用已提交审核" });
    }
    if ((body.action || "") === "withdraw") {
      const result = await withdrawLogisticsExpenseBill(request, actor, id);
      return ok({ success: true, ...result, message: "物流费用账单已撤回为草稿" });
    }
    if ((body.action || "") === "voidBill") {
      const result = await voidLogisticsExpenseBill(request, actor, id, body);
      return ok({ success: true, ...result, message: "物流费用账单已作废" });
    }
    if ((body.action || "") === "resendInvoiceNotice") {
      const result = await resendLogisticsExpenseInvoiceNotice(request, actor, id);
      const message = result.emailError
        ? `开票通知发送失败：${result.emailError}`
        : "开票通知已重新发送";
      return ok({ success: true, ...result, message });
    }
    if ((body.action || "") === "confirmInvoice") {
      const result = await confirmLogisticsExpenseInvoice(request, actor, id, body);
      return ok({ success: true, ...result, message: "物流发票已确认" });
    }
    if ((body.action || "") === "manualConfirmInvoiceValidation") {
      const result = await manuallyConfirmLogisticsInvoiceValidation(request, actor, id, body);
      return ok({ success: true, ...result, message: "物流发票校验已人工确认通过" });
    }
    if ((body.action || "") === "rerunInvoiceRecognition" || (body.action || "") === "recognizeInvoice") {
      const result = await rerunLogisticsExpenseInvoiceRecognition(request, actor, id, body);
      return ok({ success: true, ...result, message: result.message || "物流发票OCR校验结果已更新" });
    }
    if ((body.action || "") === "paymentStatus" || (body.action || "") === "markPaid") {
      const result = await updateLogisticsExpensePaymentStatus(request, actor, id, body);
      return ok({ success: true, ...result, message: "物流费用付款状态已更新" });
    }
    if ((body.action || "") === "reversePayment" || (body.action || "") === "correctPayment") {
      const result = await reverseLogisticsExpensePayment(request, actor, id, body);
      return ok({ success: true, ...result, message: "物流费用付款已冲销，可作废账单后重新录入正确金额" });
    }
    const expense = await updateLogisticsExpense(request, actor, id, body);
    return ok({
      success: true,
      expense,
      message: body.action === "submit"
        ? "物流费用已提交审核"
        : (body.action === "updateAmount" ? "物流费用金额已更新" : "物流费用已保存"),
    });
  } catch (error: unknown) {
    return apiError(maskLogisticsActionTimeoutError(error, requestAction), "更新物流费用失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const result = await withdrawLogisticsExpenseBill(request, actor, id);
    return ok({ success: true, ...result, message: "物流费用账单已撤回为草稿" });
  } catch (error: unknown) {
    return apiError(error, "撤回物流费用失败");
  }
}

function maskLogisticsActionTimeoutError(error: unknown, action = "") {
  const message = String((error as { message?: string })?.message || "");
  if (!/expired transaction|Transaction API error|timeout|timed out|P2028/i.test(message)) return error;
  if (["reversePayment", "correctPayment"].includes(action)) {
    logServerError("物流费用付款冲销事务超时", error);
    return codedError("付款冲销失败：系统处理超时，请稍后重试。", 500, "LOGISTICS_PAYMENT_REVERSAL_TIMEOUT");
  }
  if (["paymentStatus", "markPaid"].includes(action)) {
    logServerError("物流费用付款更新事务超时", error);
    return codedError("付款状态更新失败：系统处理超时，请稍后重试。", 500, "LOGISTICS_PAYMENT_UPDATE_TIMEOUT");
  }
  if (["approve", "reject", "reopen"].includes(action)) {
    logServerError("物流费用审核事务超时", error);
    return codedError("审核失败：系统处理超时，请稍后重试。", 500, "LOGISTICS_REVIEW_TIMEOUT");
  }
  logServerError("物流费用操作超时", error);
  return codedError("物流费用操作失败：系统处理超时，请稍后重试。", 500, "LOGISTICS_ACTION_TIMEOUT");
}
