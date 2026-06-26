import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, listDomesticLogisticsOrders, logServerError, ok, parseJsonBody, saveDomesticLogisticsInfo } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let actor: Awaited<ReturnType<typeof getActor>>;
  try {
    actor = await getActor(request);
  } catch (error: unknown) {
    return apiError(error, "读取物流信息失败");
  }
  const query = new URL(request.url).searchParams;
  try {
    return ok({ rows: await listDomesticLogisticsOrders(query, actor) });
  } catch (error: unknown) {
    logServerError("API failed: domestic-logistics list", error);
    return ok({ rows: [], error: "读取资料失败" });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const info = await saveDomesticLogisticsInfo(request, actor, body);
    return NextResponse.json({ success: true, info, message: "物流信息已提交" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存物流信息失败");
  }
}
