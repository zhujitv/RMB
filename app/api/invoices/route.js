import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "模块已重命名为应收订单，请使用 /api/orders。" },
    { status: 410 },
  );
}
