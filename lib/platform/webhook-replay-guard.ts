import { prisma } from "../prisma";

const WEBHOOK_REPLAY_KEY_PREFIX = "__webhook_replay__:";

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
        value: { provider, receivedAt: now.toISOString() },
      },
    });
    return { claimed: true, key };
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") return { claimed: false, key };
    throw error;
  }
}

export async function releaseWebhookReplayClaim(key: string) {
  await prisma.systemSetting.delete({ where: { key } }).catch(() => null);
}
