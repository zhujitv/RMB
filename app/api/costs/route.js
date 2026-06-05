import { apiError, getActor, listCosts, ok, saveCost } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ costs: await listCosts(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取成本失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ cost: await saveCost(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存成本失败");
  }
}
