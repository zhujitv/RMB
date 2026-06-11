import { apiError, getActor, listLogisticsSupplierExpenses, ok, saveLogisticsSupplierExpense } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const data = await listLogisticsSupplierExpenses(query, actor);
    return ok({ success: true, data, expenses: data.rows || data });
  } catch (error) {
    return apiError(error, "读取物流供应商费用失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const expense = await saveLogisticsSupplierExpense(request, actor, body);
    return ok({ success: true, expense, data: expense, message: "物流费用已保存" }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存物流供应商费用失败");
  }
}
