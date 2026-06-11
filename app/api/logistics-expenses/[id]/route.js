import { apiError, getActor, getLogisticsSupplierExpense, ok, reviewLogisticsSupplierExpense, saveLogisticsSupplierExpense, submitLogisticsSupplierExpense } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const expense = await getLogisticsSupplierExpense(id, actor);
    return ok({ success: true, expense, data: expense });
  } catch (error) {
    return apiError(error, "读取物流供应商费用失败");
  }
}

export async function PATCH(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await request.json();
    const action = String(body.action || "").trim();
    const expense = action
      ? (action === "submit"
        ? await submitLogisticsSupplierExpense(request, actor, id)
        : await reviewLogisticsSupplierExpense(request, actor, id, action, body))
      : await saveLogisticsSupplierExpense(request, actor, body, id);
    return ok({ success: true, expense, data: expense, message: "物流费用状态已更新" });
  } catch (error) {
    return apiError(error, "更新物流供应商费用失败");
  }
}
