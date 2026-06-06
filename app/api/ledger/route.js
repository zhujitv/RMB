import { apiError, canRead, getActor, getOverview, listCosts, listCustomers, listOrders, listPayments, listSuppliers, listUsers, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const [overview, orders, payments, costs, customers, suppliers, users] = await Promise.all([
      getOverview(query, actor),
      canRead(actor, "orders") ? listOrders(query, actor) : [],
      canRead(actor, "payments") ? listPayments(query, actor) : [],
      canRead(actor, "costs") ? listCosts(query, actor) : [],
      canRead(actor, "customers") ? listCustomers(query, actor) : [],
      canRead(actor, "suppliers") ? listSuppliers(query, actor) : [],
      canRead(actor, "users") ? listUsers(actor) : [],
    ]);
    return ok({ overview, orders, payments, costs, customers, suppliers, users });
  } catch (error) {
    return apiError(error, "读取平台数据失败");
  }
}
