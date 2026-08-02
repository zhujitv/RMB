import { prisma } from "../prisma";
import { codedError } from "./shared-base-utils";
import { getWechatMiniSettings } from "./wechat-mini-config";

type MiniActor = { id: string; bindingId: string; openId: string };

export async function getWechatMiniSubscriptionStatus(actor: MiniActor) {
  const settings = await getWechatMiniSettings();
  const available = settings.trackingTemplateId ? await prisma.wechatMiniSubscriptionGrant.count({
    where: {
      userId: actor.id,
      templateId: settings.trackingTemplateId,
      status: "AVAILABLE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  }) : 0;
  return {
    enabled: settings.enabled,
    templateId: settings.trackingTemplateId,
    availableGrantCount: available,
    needsAuthorization: settings.enabled && Boolean(settings.trackingTemplateId) && available < 2,
  };
}

export async function recordWechatMiniSubscriptionGrant(actor: MiniActor, input: Record<string, unknown>) {
  const settings = await getWechatMiniSettings();
  if (!settings.enabled || !settings.trackingTemplateId) {
    throw codedError("小程序物流订阅通知尚未配置", 503, "WECHAT_MINI_SUBSCRIPTION_DISABLED");
  }
  if (input.accepted !== true || input.templateId !== settings.trackingTemplateId) {
    throw codedError("未获得本次订阅授权", 400, "WECHAT_MINI_SUBSCRIPTION_NOT_ACCEPTED");
  }
  const available = await prisma.wechatMiniSubscriptionGrant.count({
    where: { userId: actor.id, templateId: settings.trackingTemplateId, status: "AVAILABLE" },
  });
  if (available >= 20) return getWechatMiniSubscriptionStatus(actor);
  await prisma.wechatMiniSubscriptionGrant.create({
    data: {
      userId: actor.id,
      bindingId: actor.bindingId,
      openId: actor.openId,
      templateId: settings.trackingTemplateId,
      status: "AVAILABLE",
    },
  });
  return getWechatMiniSubscriptionStatus(actor);
}
