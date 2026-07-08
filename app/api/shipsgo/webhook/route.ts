import type { NextRequest } from "next/server";
import { apiError, handleShipsgoWebhook, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
	    const rawBody = await request.text();
	    const signature = request.headers.get("X-Shipsgo-Webhook-Signature");
	    const result = await handleShipsgoWebhook(rawBody, signature, request.headers);
    return ok(result);
  } catch (error: unknown) {
    return apiError(error, "处理大掌櫃 Webhook 失败");
  }
}
