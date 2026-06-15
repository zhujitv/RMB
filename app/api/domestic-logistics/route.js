import { apiError, getActor, listDomesticLogisticsOrders, ok, saveDomesticLogisticsInfo } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ rows: await listDomesticLogisticsOrders(query, actor) });
  } catch (error) {
    return apiError(error, "读取物流信息失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const info = await saveDomesticLogisticsInfo(request, actor, body);
    return ok({ success: true, info, message: "物流信息已提交" }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存物流信息失败");
  }
}
