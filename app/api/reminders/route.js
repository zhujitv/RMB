import { NextResponse } from "next/server";
import { readPaymentReminders } from "../../../lib/reminders";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      reminders: await readPaymentReminders(),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "REMINDER_READ_FAILED" },
      { status: 500 },
    );
  }
}
