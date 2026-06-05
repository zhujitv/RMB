import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "模块已重命名为收款登记，请使用 /api/payments。" },
    { status: 410 },
  );
}
