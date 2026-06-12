import { apiError, getActor, listLogisticsExpenses, ok, saveLogisticsExpenses } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const rows = await listLogisticsExpenses(new URL(request.url).searchParams, actor);
    return ok({ success: true, ...rows });
  } catch (error) {
    return apiError(error, "读取物流费用失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const result = await saveLogisticsExpenses(request, actor, body);
    return ok({ success: true, ...result, message: "物流费用已提交" }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存物流费用失败");
  }
}
