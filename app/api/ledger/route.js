import { NextResponse } from "next/server";
import { readLedger } from "../../../lib/ledger-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readLedger());
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "LEDGER_READ_FAILED" },
      { status: 500 },
    );
  }
}
