import { NextResponse } from "next/server";
import { clearSessionCookies, revokeCurrentSession } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  await revokeCurrentSession(request).catch(() => {});
  const response = NextResponse.json({ ok: true });
  clearSessionCookies(response);
  return response;
}
