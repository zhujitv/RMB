import type { NextRequest } from "next/server";
import { apiError, confirmLogisticsExpenseInvoice, getActor, ok, reviewLogisticsExpense, updateLogisticsExpense, updateLogisticsExpensePaymentStatus } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type LogisticsExpenseBody = Record<string, unknown> & {
  action?: string;
  reviewAction?: string;
  auditAction?: string;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = (await request.json()) as LogisticsExpenseBody;
    const reviewAction = body.action || body.reviewAction || body.auditAction || "";
    if (["approve", "reject", "reopen"].includes(reviewAction)) {
      const result = await reviewLogisticsExpense(request, actor, id, body);
      return ok({ success: true, ...result, message: result.emailError ? "物流费用已审核，开票通知发送失败" : "物流费用已审核" });
    }
    if ((body.action || "") === "confirmInvoice") {
      const expense = await confirmLogisticsExpenseInvoice(request, actor, id, body);
      return ok({ success: true, expense, message: "物流发票已确认" });
    }
    if ((body.action || "") === "paymentStatus" || (body.action || "") === "markPaid") {
      const expense = await updateLogisticsExpensePaymentStatus(request, actor, id, body);
      return ok({ success: true, expense, message: "物流费用付款状态已更新" });
    }
    const expense = await updateLogisticsExpense(request, actor, id, body);
    return ok({ success: true, expense, message: "物流费用已保存" });
  } catch (error: unknown) {
    return apiError(error, "更新物流费用失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const expense = await updateLogisticsExpense(request, actor, id, { action: "withdraw" });
    return ok({ success: true, expense, message: "物流费用已撤回为草稿" });
  } catch (error: unknown) {
    return apiError(error, "撤回物流费用失败");
  }
}
