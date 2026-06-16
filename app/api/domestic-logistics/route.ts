import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, listDomesticLogisticsOrders, ok, saveDomesticLogisticsInfo } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ rows: await listDomesticLogisticsOrders(query, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取物流信息失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const info = await saveDomesticLogisticsInfo(request, actor, body);
    return NextResponse.json({ success: true, info, message: "物流信息已提交" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存物流信息失败");
  }
}
