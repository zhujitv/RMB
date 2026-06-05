import { NextResponse } from "next/server";
import { deleteCost } from "../../../../lib/ledger-db";

export const dynamic = "force-dynamic";

export async function DELETE(_request, context) {
  try {
    const { id } = await context.params;
    await deleteCost(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "COST_DELETE_FAILED" },
      { status: 500 },
    );
  }
}
