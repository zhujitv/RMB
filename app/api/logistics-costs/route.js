import { apiError, getActor, ok, saveLogisticsCost } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const cost = await saveLogisticsCost(request, actor, body);
    return ok({ success: true, cost, message: "物流费用已保存" }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存物流费用失败");
  }
}
