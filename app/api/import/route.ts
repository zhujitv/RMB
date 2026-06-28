import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireApiActor(request);
    return NextResponse.json(
      { error: "当前平台正式数据源为 PostgreSQL，不再支持把 localStorage 作为业务数据导入。" },
      { status: 410 },
    );
  } catch (error: unknown) {
    return apiError(error, "导入接口不可用");
  }
}
