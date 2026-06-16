import type { NextRequest } from "next/server";
import { apiError, canRead, getActor, getOverview, listOrders, listPayments, ok, requireAdminGlobal } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

const listOrdersTyped = listOrders as (query: URLSearchParams, actor: unknown) => Promise<unknown[]>;
const listPaymentsTyped = listPayments as (query: URLSearchParams, actor: unknown) => Promise<unknown[]>;

export async function GET(request: NextRequest) {
  try {
    const actor = (await getActor(request))!;
    requireAdminGlobal(actor, "无权限访问经营总览");
    const query = new URL(request.url).searchParams;
    const [overview, orders, payments] = await Promise.all([
      getOverview(query, actor),
      canRead(actor, "orders") ? listOrdersTyped(query, actor) : [],
      canRead(actor, "payments") ? listPaymentsTyped(query, actor) : [],
    ]);
    return ok({ overview, orders, payments, costs: [] });
  } catch (error: unknown) {
    return apiError(error, "读取平台数据失败");
  }
}
