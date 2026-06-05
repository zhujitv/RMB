import { apiError, getActor, getOverview, listCosts, listCustomers, listOrders, listPayments, listUsers, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const [overview, orders, payments, costs, customers, users] = await Promise.all([
      getOverview(query, actor),
      listOrders(query, actor),
      listPayments(query, actor),
      listCosts(query, actor),
      listCustomers(query, actor),
      listUsers(),
    ]);
    return ok({ overview, orders, payments, costs, customers, users });
  } catch (error) {
    return apiError(error, "读取平台数据失败");
  }
}
