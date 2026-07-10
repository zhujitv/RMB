import { prisma } from "../prisma";

const WEBHOOK_REPLAY_KEY_PREFIX = "__webhook_replay__:";
const WEBHOOK_PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;

function replayGuardKey(provider: string, fingerprint: string) {
  const safeProvider = provider.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32) || "unknown";
  const safeFingerprint = fingerprint.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 128);
  return `${WEBHOOK_REPLAY_KEY_PREFIX}${safeProvider}:${safeFingerprint}`;
}

export async function claimWebhookReplay(
  provider: string,
  fingerprint: string,
  retentionMs = 90 * 24 * 60 * 60 * 1000,
) {
  const key = replayGuardKey(provider, fingerprint);
  const now = new Date();
  const cutoff = new Date(now.getTime() - retentionMs);
  await prisma.systemSetting.deleteMany({
    where: {
      key: { startsWith: `${WEBHOOK_REPLAY_KEY_PREFIX}${provider.toLowerCase()}:` },
      updatedAt: { lt: cutoff },
    },
  }).catch(() => null);
  try {
    await prisma.systemSetting.create({
      data: {
        key,
        value: { provider, status: "processing", receivedAt: now.toISOString() },
      },
    });
    return { claimed: true, processed: false, key };
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      const existing = await prisma.systemSetting.findUnique({ where: { key } });
      const value = existing?.value as { status?: unknown } | null | undefined;
      if (
        existing
        && value?.status === "processing"
        && existing.updatedAt.getTime() < now.getTime() - WEBHOOK_PROCESSING_TIMEOUT_MS
      ) {
        const reclaimed = await prisma.systemSetting.updateMany({
          where: { key, updatedAt: existing.updatedAt },
          data: { value: { provider, status: "processing", receivedAt: now.toISOString() } },
        });
        if (reclaimed.count === 1) return { claimed: true, processed: false, key };
      }
      return { claimed: false, processed: value?.status === "processed", key };
    }
    throw error;
  }
}

export async function completeWebhookReplayClaim(key: string, provider: string) {
  await prisma.systemSetting.update({
    where: { key },
    data: {
      value: { provider, status: "processed", processedAt: new Date().toISOString() },
    },
  });
}

export async function releaseWebhookReplayClaim(key: string) {
  await prisma.systemSetting.delete({ where: { key } }).catch(() => null);
}
