import { NextResponse } from "next/server";
import { apiError, getActor } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    await getActor(request);
    return NextResponse.json(
      { error: "模块已重命名为收款登记，请使用 /api/payments。" },
      { status: 410 },
    );
  } catch (error) {
    return apiError(error, "请先登录");
  }
}
