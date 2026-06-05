import { NextResponse } from "next/server";
import { readPaymentReminders, reminderMessage } from "../../../../lib/reminders";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const reminders = await readPaymentReminders();
    const message = reminderMessage(reminders);

    if (process.env.REMINDER_WEBHOOK_URL) {
      const response = await fetch(process.env.REMINDER_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: message, reminders }),
      });

      if (!response.ok) {
        throw new Error("reminder webhook failed");
      }
    }

    return NextResponse.json({
      ok: true,
      delivered: Boolean(process.env.REMINDER_WEBHOOK_URL),
      reminders,
      message,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "REMINDER_RUN_FAILED" },
      { status: 500 },
    );
  }
}
