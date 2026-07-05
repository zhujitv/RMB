import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  listDomesticLogisticsOrders,
  ok,
  parseJsonBody,
  readShipsgoFeatureFlags,
  saveDomesticLogisticsInfo,
} from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let actor: Awaited<ReturnType<typeof requireApiActor>>;
  try {
    actor = await requireApiActor(request);
  } catch (error: unknown) {
    return apiError(error, "读取物流信息失败");
  }
  const query = new URL(request.url).searchParams;
  try {
    const [rows, shipsgo] = await Promise.all([
      listDomesticLogisticsOrders(query, actor),
      readShipsgoFeatureFlags(),
    ]);
    return ok({ rows, shipsgo });
  } catch (error: unknown) {
    return apiError(error, "读取物流信息失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const info = await saveDomesticLogisticsInfo(request, actor, body);
    return NextResponse.json({ success: true, info, message: "物流信息已提交" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存物流信息失败");
  }
}
