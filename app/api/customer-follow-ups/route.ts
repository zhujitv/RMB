import { NextResponse, type NextRequest } from "next/server";
import { apiError, listCustomerFollowUps, parseJsonBody, saveCustomerFollowUp } from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const data = await listCustomerFollowUps(new URL(request.url).searchParams, actor);
    return NextResponse.json({ success: true, data, rows: data.rows });
  } catch (error: unknown) {
    return apiError(error, "读取客户跟进记录失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const followUp = await saveCustomerFollowUp(request, actor, body);
    return NextResponse.json({
      success: true,
      data: followUp,
      followUp,
      message: "跟进记录已保存",
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存客户跟进记录失败");
  }
}
