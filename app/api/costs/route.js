import { apiError, getActor, listCostOrderSummaries, listCostsPage, ok, saveCost, saveCosts } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const data = query.get("view") === "orders"
      ? await listCostOrderSummaries(query, actor)
      : await listCostsPage(query, actor);
    return ok({ success: true, data, costs: data.rows });
  } catch (error) {
    return apiError(error, "读取成本失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    if (Array.isArray(body.items)) {
      return ok({ success: true, costs: await saveCosts(request, actor, body) });
    }
    return ok({ success: true, cost: await saveCost(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存成本失败");
  }
}
