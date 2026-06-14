import { apiError, getActor, listPayments, ok, savePayment } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const paginated = query.get("workspace") === "1" || query.has("page") || query.has("pageSize");
    const result = await listPayments(query, actor, { paginated });
    return paginated
      ? ok({ success: true, data: result, payments: result.rows || [] })
      : ok({ payments: result });
  } catch (error) {
    return apiError(error, "读取收款失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const payment = await savePayment(request, actor, body);
    return ok({ success: true, payment, message: "收款已保存" }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存收款失败");
  }
}
