import { NextResponse, type NextRequest } from "next/server";
import { apiError, listCustomerBusinessRecords } from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const data = await listCustomerBusinessRecords(new URL(request.url).searchParams, actor);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return apiError(error, "读取客户发货订单与应收款失败");
  }
}
