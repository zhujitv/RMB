import { apiError, canRead, getActor, getOverview, listOrders, listPayments, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const [overview, orders, payments] = await Promise.all([
      getOverview(query, actor),
      canRead(actor, "orders") ? listOrders(query, actor) : [],
      canRead(actor, "payments") ? listPayments(query, actor) : [],
    ]);
    return ok({ overview, orders, payments, costs: [] });
  } catch (error) {
    return apiError(error, "读取平台数据失败");
  }
}
