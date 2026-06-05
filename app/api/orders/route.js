import { apiError, getActor, listOrders, ok, saveOrder } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ orders: await listOrders(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取应收订单失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ order: await saveOrder(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存应收订单失败");
  }
}
