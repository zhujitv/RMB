import type { NextRequest } from "next/server";
import { apiError, codedError, handleShipsgoWebhook, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

const WEBHOOK_BODY_MAX_BYTES = 1024 * 1024;

async function readWebhookBody(request: NextRequest) {
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredSize) && declaredSize > WEBHOOK_BODY_MAX_BYTES) {
    throw codedError("飞驼可视推送正文超过 1 MiB 限制。", 413, "FREIGHTOWER_WEBHOOK_BODY_TOO_LARGE");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > WEBHOOK_BODY_MAX_BYTES) {
      await reader.cancel();
      throw codedError("飞驼可视推送正文超过 1 MiB 限制。", 413, "FREIGHTOWER_WEBHOOK_BODY_TOO_LARGE");
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await readWebhookBody(request);
    return ok(await handleShipsgoWebhook(rawBody, null, request.headers));
  } catch (error: unknown) {
    return apiError(error, "处理飞驼可视 Webhook 失败");
  }
}
