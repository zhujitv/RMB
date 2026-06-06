import { apiError, getActor, ok, saveLogisticsCost } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ cost: await saveLogisticsCost(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存物流费用失败");
  }
}
