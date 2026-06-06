import { NextResponse } from "next/server";
import { apiError, getActor } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await getActor(request);
    return NextResponse.json(
      { error: "当前平台正式数据源为 PostgreSQL，不再支持把 localStorage 作为业务数据导入。" },
      { status: 410 },
    );
  } catch (error) {
    return apiError(error, "导入接口不可用");
  }
}
