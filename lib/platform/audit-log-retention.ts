import { prisma } from "../prisma";

export const AUDIT_LOG_RETENTION_DAYS = 30;

export function auditLogRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export async function cleanupExpiredAuditLogs(now = new Date()) {
  const cutoff = auditLogRetentionCutoff(now);
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return {
    deleted: result.count,
    cutoff: cutoff.toISOString(),
    retentionDays: AUDIT_LOG_RETENTION_DAYS,
  };
}
