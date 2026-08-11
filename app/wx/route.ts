import type { NextRequest } from "next/server";
import { confirmWechatSubscriptionCallback } from "../../lib/platform-db";

export const dynamic = "force-dynamic";

function resultRedirect(result: string) {
  const url = new URL("https://www.nextwood.net/");
  url.searchParams.set("workbenchTarget", "/account");
  url.searchParams.set("wechatSubscription", result);
  return Response.redirect(url, 303);
}

export async function GET(request: NextRequest) {
  try {
    const result = await confirmWechatSubscriptionCallback(request.nextUrl.searchParams);
    return resultRedirect(result.confirmed ? "confirmed" : "cancelled");
  } catch {
    return resultRedirect("failed");
  }
}
