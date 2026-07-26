import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { deleteR2Object } from "../r2";

export const FILE_STORAGE_DELETE_OUTBOX_TYPE = "FILE_STORAGE_DELETE";
export const FILE_STORAGE_DELETE_MAX_ATTEMPTS = 8;
export const DEFAULT_FILE_STORAGE_SOFT_DELETE_RETENTION_DAYS = 30;
const FILE_STORAGE_DELETE_LEASE_MS = 10 * 60 * 1000;

type FileDeletionOutboxClient = {
  notificationOutbox: {
    upsert(args: Prisma.NotificationOutboxUpsertArgs): Promise<unknown>;
  };
};

type FileDeletionContext = {
  storageKey?: unknown;
  sourceTable?: unknown;
  sourceId?: unknown;
  fileRole?: unknown;
};

function deletionOutboxKey(storageKey: string) {
  const digest = createHash("sha256").update(storageKey).digest("hex");
  return `file-storage-delete:${digest}`;
}

function softDeleteRetentionMs() {
  const configuredDays = Number(process.env.FILE_STORAGE_SOFT_DELETE_RETENTION_DAYS || DEFAULT_FILE_STORAGE_SOFT_DELETE_RETENTION_DAYS);
  const days = Math.min(365, Math.max(7, Number.isFinite(configuredDays) ? Math.trunc(configuredDays) : DEFAULT_FILE_STORAGE_SOFT_DELETE_RETENTION_DAYS));
  return days * 24 * 60 * 60 * 1000;
}

function contextRecord(value: unknown): FileDeletionContext {
  return value && typeof value === "object" && !Array.isArray(value) ? value as FileDeletionContext : {};
}

export async function enqueueFileStorageDeletion(
  client: FileDeletionOutboxClient,
  input: { storageKey: string; sourceTable: string; sourceId: string; fileRole: string; deleteAfter?: Date },
) {
  const storageKey = String(input.storageKey || "").trim();
  if (!storageKey) return null;
  const idempotencyKey = deletionOutboxKey(storageKey);
  const scheduledAt = input.deleteAfter instanceof Date
    ? input.deleteAfter
    : new Date(Date.now() + softDeleteRetentionMs());
  const context = {
    storageKey,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    fileRole: input.fileRole,
  };
  return client.notificationOutbox.upsert({
    where: { idempotencyKey },
    create: {
      type: FILE_STORAGE_DELETE_OUTBOX_TYPE,
      idempotencyKey,
      status: "pending",
      recipientEmails: [],
      subject: "Delete managed storage object",
      body: "",
      context,
      relatedEntityType: input.sourceTable,
      relatedEntityId: input.sourceId,
      scheduledAt,
    },
    update: {
      status: "pending",
      attempts: 0,
      sentAt: null,
      failedAt: null,
      lastError: null,
      context,
      relatedEntityType: input.sourceTable,
      relatedEntityId: input.sourceId,
      scheduledAt,
    },
  });
}

async function processFileStorageDeletionRow(id: string) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - FILE_STORAGE_DELETE_LEASE_MS);
  const claimed = await prisma.notificationOutbox.updateMany({
    where: {
      id,
      type: FILE_STORAGE_DELETE_OUTBOX_TYPE,
      scheduledAt: { lte: now },
      OR: [
        { status: { in: ["pending", "failed"] }, attempts: { lt: FILE_STORAGE_DELETE_MAX_ATTEMPTS } },
        { status: "processing", updatedAt: { lte: staleBefore } },
      ],
    },
    data: { status: "processing", attempts: { increment: 1 }, lastError: null },
  });
  if (claimed.count !== 1) return { id, deleted: false, skipped: false, claimed: false, queued: false };
  const row = await prisma.notificationOutbox.findUnique({ where: { id } });
  const context = contextRecord(row?.context);
  const storageKey = String(context.storageKey || "").trim();
  try {
    if (!storageKey) throw new Error("file deletion task storage key missing");
    const currentAsset = await prisma.fileAsset.findFirst({
      where: {
        sourceTable: String(context.sourceTable || ""),
        sourceId: String(context.sourceId || ""),
        fileRole: String(context.fileRole || ""),
      },
      select: { storageKey: true, isDeleted: true, deletedAt: true },
    });
    if (currentAsset?.storageKey === storageKey && !currentAsset.isDeleted && !currentAsset.deletedAt) {
      await prisma.notificationOutbox.updateMany({
        where: { id, status: "processing", attempts: row?.attempts || 0 },
        data: { status: "skipped", failedAt: null, lastError: null },
      });
      return { id, deleted: false, skipped: true, claimed: true, queued: false };
    }
    await deleteR2Object(storageKey);
    await prisma.notificationOutbox.updateMany({
      where: { id, status: "processing", attempts: row?.attempts || 0 },
      data: { status: "sent", sentAt: new Date(), failedAt: null, lastError: null },
    });
    return { id, deleted: true, skipped: false, claimed: true, queued: false };
  } catch (error) {
    const attempts = Number(row?.attempts || 1);
    const retryDelayMs = Math.min(60 * 60 * 1000, 15_000 * (2 ** Math.max(0, attempts - 1)));
    const queued = attempts < FILE_STORAGE_DELETE_MAX_ATTEMPTS;
    await prisma.notificationOutbox.updateMany({
      where: { id, status: "processing", attempts },
      data: {
        status: "failed",
        failedAt: new Date(),
        lastError: (error instanceof Error ? error.message : String(error || "storage delete failed")).slice(0, 500),
        scheduledAt: new Date(Date.now() + retryDelayMs),
      },
    });
    return { id, deleted: false, skipped: false, claimed: true, queued };
  }
}

export async function processFileStorageDeletionOutbox(limit = 20) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - FILE_STORAGE_DELETE_LEASE_MS);
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(Number(limit) || 20)));
  const rows = await prisma.notificationOutbox.findMany({
    where: {
      type: FILE_STORAGE_DELETE_OUTBOX_TYPE,
      scheduledAt: { lte: now },
      OR: [
        { status: { in: ["pending", "failed"] }, attempts: { lt: FILE_STORAGE_DELETE_MAX_ATTEMPTS } },
        { status: "processing", updatedAt: { lte: staleBefore } },
      ],
    },
    select: { id: true },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: safeLimit,
  });
  const results: Awaited<ReturnType<typeof processFileStorageDeletionRow>>[] = [];
  for (const row of rows) results.push(await processFileStorageDeletionRow(row.id));
  return {
    scanned: rows.length,
    deleted: results.filter((result) => result.deleted).length,
    skipped: results.filter((result) => result.skipped).length,
    failed: results.filter((result) => result.claimed && !result.deleted && !result.skipped).length,
    queued: results.filter((result) => result.queued).length,
  };
}
