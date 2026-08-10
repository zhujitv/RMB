import crypto from "node:crypto";
import { prisma } from "../prisma";

const FREIGHTOWER_SYNC_LEASE_MS = 5 * 60 * 1000;

export function createFreightowerTrackingSyncLease(now = new Date()) {
  return {
    token: crypto.randomUUID(),
    expiresAt: new Date(now.getTime() + FREIGHTOWER_SYNC_LEASE_MS),
  };
}

export async function claimFreightowerTrackingSyncLease(trackingId: string) {
  const now = new Date();
  const { token, expiresAt } = createFreightowerTrackingSyncLease(now);
  const count = await prisma.$executeRaw`
    UPDATE "shipsgo_trackings"
    SET "sync_lease_token" = ${token}, "sync_lease_expires_at" = ${expiresAt}
    WHERE "id" = ${trackingId}
      AND "deleted_at" IS NULL
      AND (
        "sync_lease_token" IS NULL
        OR "sync_lease_expires_at" IS NULL
        OR "sync_lease_expires_at" <= ${now}
      )
  `;
  return count === 1 ? token : null;
}

export async function releaseFreightowerTrackingSyncLease(trackingId: string, token: string) {
  return prisma.$executeRaw`
    UPDATE "shipsgo_trackings"
    SET "sync_lease_token" = NULL, "sync_lease_expires_at" = NULL
    WHERE "id" = ${trackingId} AND "sync_lease_token" = ${token}
  `;
}
