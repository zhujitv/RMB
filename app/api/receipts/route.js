import { NextResponse } from "next/server";
import { upsertReceipt } from "../../../lib/ledger-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json(await upsertReceipt(body));
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "RECEIPT_SAVE_FAILED" },
      { status: 500 },
    );
  }
}
