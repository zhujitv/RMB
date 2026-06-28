import { NextResponse, type NextRequest } from "next/server";
import { apiError, listLogisticsExpenses, ok, parseJsonBody, saveLogisticsExpenses } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const rows = await listLogisticsExpenses(new URL(request.url).searchParams, actor);
    return ok({ success: true, ...rows });
  } catch (error: unknown) {
    return apiError(error, "读取物流费用失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await saveLogisticsExpenses(request, actor, body);
    return NextResponse.json({ success: true, ...result, message: "物流费用已提交" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存物流费用失败");
  }
}
