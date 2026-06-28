import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireApiActor(request);
    return NextResponse.json(
      { error: "模块已重命名为应收订单，请使用 /api/orders。" },
      { status: 410 },
    );
  } catch (error: unknown) {
    return apiError(error, "请先登录");
  }
}
