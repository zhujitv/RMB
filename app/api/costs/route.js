import { NextResponse } from "next/server";
import { upsertCost } from "../../../lib/ledger-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    return NextResponse.json(await upsertCost(body));
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "COST_SAVE_FAILED" },
      { status: 500 },
    );
  }
}
