import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { codedError, nonEmpty } from "./shared-base-utils";
import { getWechatOfficialSettings, serializeWechatOfficialSettings } from "./wechat-official-config";
import { assertWechatOfficialFollower, exchangeWechatOfficialOAuthCode } from "./wechat-official-provider";

type Actor = { id?: string | null } | null | undefined;

const CALLBACK_URL = "https://www.nextwood.net/wx";
const REQUEST_TTL_MS = 15 * 60 * 1000;

function actorId(actor: Actor) {
  const id = nonEmpty(actor?.id);
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validOpenId(value: unknown) {
  const openId = nonEmpty(value);
  return /^[a-zA-Z0-9_-]{8,128}$/.test(openId) ? openId : "";
}

function maskedOpenId(openId: string | null | undefined) {
  if (!openId) return "";
  if (openId.length <= 8) return "****";
  return `${openId.slice(0, 4)}****${openId.slice(-4)}`;
}

export async function readOwnWechatSubscriptionStatus(actor: Actor) {
  const userId = actorId(actor);
  const [settings, binding, attentionRequired] = await Promise.all([
    getWechatOfficialSettings(),
    prisma.wechatOfficialBinding.findUnique({ where: { userId } }),
    prisma.wechatOfficialDelivery.count({
      where: { userId, status: { in: ["permanent_failed", "outcome_unknown"] } },
    }),
  ]);
  const publicSettings = serializeWechatOfficialSettings(settings);
  return {
    available: publicSettings.ready,
    enabled: settings.enabled,
    accountCertified: settings.accountCertified,
    credentialsReady: publicSettings.credentialsReady,
    binding: binding ? {
      enabled: binding.enabled,
      openIdMasked: maskedOpenId(binding.openId),
      lastConfirmedAt: binding.lastConfirmedAt,
    } : null,
    attentionRequired,
    requirement: publicSettings.accountRequirement,
  };
}

export async function createWechatSubscriptionAuthorization(actor: Actor) {
  const userId = actorId(actor);
  const settings = await getWechatOfficialSettings();
  if (!settings.enabled || !settings.accountCertified || !settings.appId || !settings.appSecret || !settings.templateId) {
    throw codedError("微信公众号通知尚未完成企业认证或接口配置", 503, "WECHAT_OFFICIAL_NOT_READY");
  }
  await prisma.wechatOfficialSubscription.updateMany({
    where: { userId, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  const reserved = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);
  await prisma.wechatOfficialSubscription.create({
    data: {
      userId,
      tokenHash: tokenHash(reserved),
      templateId: settings.templateId,
      scene: 0,
      status: "PENDING",
      expiresAt,
    },
  });
  const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
  url.searchParams.set("appid", settings.appId);
  url.searchParams.set("redirect_uri", CALLBACK_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "snsapi_base");
  url.searchParams.set("state", reserved);
  url.hash = "wechat_redirect";
  return { authorizationUrl: url.toString(), expiresAt };
}

export async function confirmWechatSubscriptionCallback(query: URLSearchParams) {
  const reserved = nonEmpty(query.get("state"));
  const code = nonEmpty(query.get("code"));
  if (!reserved || reserved.length > 128 || !code || code.length > 256) {
    throw codedError("微信订阅回调参数不完整", 400, "WECHAT_CALLBACK_INVALID");
  }
  const identity = await exchangeWechatOfficialOAuthCode(code);
  await assertWechatOfficialFollower(identity.openId);
  const result = await prisma.$transaction((tx) => finalizeWechatOAuthBinding(tx, {
    tokenHash: tokenHash(reserved),
    openId: identity.openId,
  }));
  if (result.expired) {
    throw codedError("微信订阅请求已过期，请返回系统重新授权", 410, "WECHAT_CALLBACK_EXPIRED");
  }
  return { confirmed: result.confirmed };
}

type WechatSubscriptionCallbackTransaction = Pick<
  Prisma.TransactionClient,
  "wechatOfficialSubscription" | "wechatOfficialBinding"
>;

export type WechatOAuthBindingInput = {
  tokenHash: string;
  openId: unknown;
};

export async function finalizeWechatOAuthBinding(
  tx: WechatSubscriptionCallbackTransaction,
  input: WechatOAuthBindingInput,
  now = new Date(),
) {
  const request = await tx.wechatOfficialSubscription.findUnique({
    where: { tokenHash: input.tokenHash },
  });
  if (!request || request.status !== "PENDING") {
    throw codedError("微信订阅请求不存在或已处理", 409, "WECHAT_CALLBACK_ALREADY_USED");
  }
  if (request.expiresAt <= now) {
    const expired = await tx.wechatOfficialSubscription.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    if (expired.count !== 1) {
      throw codedError("微信订阅请求不存在或已处理", 409, "WECHAT_CALLBACK_ALREADY_USED");
    }
    return { confirmed: false, expired: true };
  }
  const openId = validOpenId(input.openId);
  if (!openId) throw codedError("微信未返回有效 OpenID", 400, "WECHAT_CALLBACK_OPENID_INVALID");
  const claimed = await tx.wechatOfficialSubscription.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count !== 1) {
    throw codedError("微信订阅请求不存在或已处理", 409, "WECHAT_CALLBACK_ALREADY_USED");
  }
  const existingBinding = await tx.wechatOfficialBinding.findUnique({ where: { openId } });
  if (existingBinding && existingBinding.userId !== request.userId) {
    throw codedError("该微信账号已绑定其他系统用户", 409, "WECHAT_OPENID_ALREADY_BOUND");
  }
  await tx.wechatOfficialBinding.upsert({
    where: { userId: request.userId },
    update: { openId, enabled: true, lastConfirmedAt: now },
    create: { userId: request.userId, openId, enabled: true, lastConfirmedAt: now },
  });
  const confirmed = await tx.wechatOfficialSubscription.updateMany({
    where: { id: request.id, status: "PROCESSING" },
    data: { openId, status: "BOUND", confirmedAt: now },
  });
  if (confirmed.count !== 1) {
    throw codedError("微信订阅请求状态冲突", 409, "WECHAT_CALLBACK_STATE_CONFLICT");
  }
  return { confirmed: true, expired: false };
}

export async function unlinkOwnWechatOfficialAccount(actor: Actor) {
  const userId = actorId(actor);
  await prisma.$transaction([
    prisma.wechatOfficialBinding.updateMany({ where: { userId }, data: { enabled: false } }),
    prisma.wechatOfficialSubscription.updateMany({
      where: { userId, status: { in: ["PENDING", "CONFIRMED", "RESERVED", "BOUND"] } },
      data: { status: "CANCELLED" },
    }),
    prisma.wechatOfficialDelivery.updateMany({
      where: { userId, status: { in: ["pending", "failed"] } },
      data: { status: "cancelled", lastError: "用户已停止微信通知" },
    }),
  ]);
  return { success: true, message: "已停止该账号的微信物流通知" };
}
