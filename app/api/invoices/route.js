import { NextResponse } from "next/server";
import { upsertInvoice } from "../../../lib/ledger-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json(await upsertInvoice(body));
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "INVOICE_SAVE_FAILED" },
      { status: 500 },
    );
  }
}
