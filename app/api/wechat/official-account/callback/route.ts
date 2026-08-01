import type { NextRequest } from "next/server";

import {
  decryptWeChatOfficialAccountMessage,
  extractWeChatEncryptedPayload,
  readWeChatRequestBody,
  readWeChatSecureMessageConfig,
  readWeChatVerificationToken,
  verifyWeChatSha1Signature,
  verifyWeChatUrlChallenge,
  WeChatOfficialAccountError,
} from "../../../../../lib/wechat-official-account";

export const dynamic = "force-dynamic";

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function errorResponse(error: unknown) {
  const status = error instanceof WeChatOfficialAccountError ? error.status : 500;
  return textResponse(status >= 500 ? "Service Unavailable" : "Forbidden", status);
}

export async function GET(request: NextRequest) {
  try {
    const query = new URL(request.url).searchParams;
    const echoStr = verifyWeChatUrlChallenge({
      token: readWeChatVerificationToken(),
      signature: query.get("signature"),
      timestamp: query.get("timestamp"),
      nonce: query.get("nonce"),
      echoStr: query.get("echostr"),
    });
    return textResponse(echoStr);
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const query = new URL(request.url).searchParams;
    if (query.get("encrypt_type") !== "aes") {
      throw new WeChatOfficialAccountError(
        "公众号回调只接受安全模式消息。",
        400,
        "WECHAT_OFFICIAL_ACCOUNT_AES_REQUIRED",
      );
    }
    const timestamp = query.get("timestamp") || "";
    const nonce = query.get("nonce") || "";
    const rawBody = await readWeChatRequestBody(request);
    const encrypted = extractWeChatEncryptedPayload(rawBody);
    const config = readWeChatSecureMessageConfig();
    if (!verifyWeChatSha1Signature(query.get("msg_signature"), [
      config.token,
      timestamp,
      nonce,
      encrypted,
    ])) {
      throw new WeChatOfficialAccountError(
        "微信消息签名校验失败。",
        403,
        "WECHAT_OFFICIAL_ACCOUNT_MESSAGE_SIGNATURE_INVALID",
      );
    }
    decryptWeChatOfficialAccountMessage({
      encrypted,
      encodingAesKey: config.encodingAesKey,
      expectedAppId: config.appId,
    });

    // 这一阶段只完成可信接入和快速 ACK；业务事件处理会在独立功能中接入。
    return textResponse("success");
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
