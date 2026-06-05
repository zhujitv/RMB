import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "当前平台正式数据源为 PostgreSQL，不再支持把 localStorage 作为业务数据导入。" },
    { status: 410 },
  );
}
