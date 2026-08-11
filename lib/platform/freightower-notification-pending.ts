import type { Prisma, ShipsgoTracking } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { extractFreightowerCustomsTimeline, latestFreightowerCustomsEvent } from "./freightower-customs-events";
import { extractFreightowerPortTimeline, latestFreightowerPortEvent } from "./freightower-port-events";
import {
  freightowerCustomsEventHasActiveAlert,
  freightowerPortEventHasActiveAlert,
} from "./freightower-supplemental-alerts";
import {
  freightowerTrackingNotificationEventKey,
  notifyFreightowerTrackingUpdate,
} from "./shipsgo-tracking-notifications";
import { freightowerComprehensivePortOperationEvent } from "./freightower-notification-events";
import {
  freightowerPortOperationEventSegment,
  isFreightowerPortOperationEvent,
} from "./freightower-port-notifications";
import {
  claimFreightowerTrackingSyncLease,
  releaseFreightowerTrackingSyncLease,
} from "./shipsgo-tracking-sync-lease";

export const FREIGHTOWER_NOTIFICATION_COMPREHENSIVE = 1;
export const FREIGHTOWER_NOTIFICATION_PORT = 2;
export const FREIGHTOWER_NOTIFICATION_CUSTOMS = 4;

export async function markFreightowerNotificationPending(
  tx: Prisma.TransactionClient,
  trackingId: string,
  sourceMask: number,
) {
  if (!sourceMask) return;
  await tx.$executeRaw`
    UPDATE "shipsgo_trackings"
    SET
      "tracking_notification_pending_mask" = "tracking_notification_pending_mask" | ${sourceMask},
      "tracking_notification_pending_at" = COALESCE("tracking_notification_pending_at", CURRENT_TIMESTAMP)
    WHERE "id" = ${trackingId}
  `;
}

function preferredPortEvent(tracking: ShipsgoTracking) {
  const events = extractFreightowerPortTimeline(tracking.portRawResponse);
  const activeDumping = [...events].reverse().find((event) => (
    event.isDumpingWarning && freightowerPortEventHasActiveAlert(events, event)
  ));
  if (activeDumping) return activeDumping;
  const operation = [...events].reverse().find(isFreightowerPortOperationEvent);
  const operationSegment = freightowerPortOperationEventSegment(operation);
  if (operation && operationSegment && !tracking.trackingNotificationQueuedKey?.includes(operationSegment)) {
    return operation;
  }
  return [...events].reverse().find((event) => (
    event.isWarning && freightowerPortEventHasActiveAlert(events, event)
  )) || latestFreightowerPortEvent(tracking.portRawResponse);
}

function preferredCustomsEvent(tracking: ShipsgoTracking) {
  const events = extractFreightowerCustomsTimeline(tracking.customsRawResponse);
  return [...events].reverse().find((event) => (
    event.isWarning && freightowerCustomsEventHasActiveAlert(events, event)
  )) || latestFreightowerCustomsEvent(tracking.customsRawResponse);
}

function pendingChanges(tracking: ShipsgoTracking, mask: number) {
  const comprehensiveOperation = freightowerComprehensivePortOperationEvent(tracking);
  const comprehensiveOperationSegment = freightowerPortOperationEventSegment(comprehensiveOperation);
  const hasNewComprehensiveOperation = Boolean(
    comprehensiveOperation
    && comprehensiveOperationSegment
    && !tracking.trackingNotificationQueuedKey?.includes(comprehensiveOperationSegment),
  );
  return [
    ...(mask & FREIGHTOWER_NOTIFICATION_COMPREHENSIVE && hasNewComprehensiveOperation
      ? [{ source: "port" as const, event: comprehensiveOperation }]
      : []),
    ...(mask & FREIGHTOWER_NOTIFICATION_PORT
      ? [{ source: "port" as const, event: preferredPortEvent(tracking) }]
      : []),
    ...(mask & FREIGHTOWER_NOTIFICATION_CUSTOMS
      ? [{ source: "customs" as const, event: preferredCustomsEvent(tracking) }]
      : []),
  ].sort((left, right) => Number(Boolean(right.event?.isWarning)) - Number(Boolean(left.event?.isWarning)));
}

export async function reconcileFreightowerTrackingNotification(
  trackingId: string,
  options: { leaseToken?: string } = {},
) {
  const ownedLeaseToken = options.leaseToken || await claimFreightowerTrackingSyncLease(trackingId);
  if (!ownedLeaseToken) return { processed: false, skipped: "locked" as const };
  const releaseLease = !options.leaseToken;
  try {
    const tracking = await prisma.shipsgoTracking.findFirst({
      where: {
        id: trackingId,
        syncLeaseToken: ownedLeaseToken,
        syncLeaseExpiresAt: { gt: new Date() },
      },
    });
    if (!tracking) return { processed: false, skipped: "lease" as const };
    if (!tracking || tracking.deletedAt || tracking.trackingNotificationPendingMask <= 0) {
      return { processed: false, skipped: "empty" as const };
    }
    const pendingMask = tracking.trackingNotificationPendingMask;
    const trackingEventKey = freightowerTrackingNotificationEventKey(tracking);
    const changeEvents = pendingChanges(tracking, pendingMask);
    await notifyFreightowerTrackingUpdate(tracking.id, {
      changeSource: changeEvents[0]?.source || "comprehensive",
      changeEvent: changeEvents[0]?.event,
      changeEvents,
      comprehensiveChanged: Boolean(pendingMask & FREIGHTOWER_NOTIFICATION_COMPREHENSIVE),
      trackingEventKey,
    });
    const latest = await prisma.shipsgoTracking.findUnique({ where: { id: tracking.id } });
    if (!latest || freightowerTrackingNotificationEventKey(latest) !== trackingEventKey) {
      return { processed: false, skipped: "changed" as const };
    }
    const cleared = await prisma.shipsgoTracking.updateMany({
      where: {
        id: tracking.id,
        syncLeaseToken: ownedLeaseToken,
        trackingNotificationPendingMask: pendingMask,
      },
      data: {
        trackingNotificationPendingAt: null,
        trackingNotificationPendingMask: 0,
        trackingNotificationQueuedKey: trackingEventKey,
      },
    });
    return { processed: cleared.count === 1, skipped: cleared.count === 1 ? null : "changed" as const };
  } finally {
    if (releaseLease) {
      await releaseFreightowerTrackingSyncLease(trackingId, ownedLeaseToken).catch((error: unknown) => {
        console.error("freightower-notification-lease-release-failed", {
          trackingId,
          message: error instanceof Error ? error.message : "unknown",
        });
      });
    }
  }
}

export async function processPendingFreightowerTrackingNotifications(options: { limit?: number } = {}) {
  const limit = Math.min(20, Math.max(1, Math.trunc(Number(options.limit || 8)) || 8));
  const rows = await prisma.shipsgoTracking.findMany({
    where: {
      provider: "FREIGHTOWER",
      deletedAt: null,
      trackingNotificationPendingAt: { not: null },
      trackingNotificationPendingMask: { gt: 0 },
    },
    select: { id: true },
    orderBy: [{ trackingNotificationPendingAt: "asc" }],
    take: limit,
  });
  const results: Array<{
    processed: boolean;
    skipped: "locked" | "lease" | "empty" | "changed" | "error" | null;
    error?: string;
  }> = [];
  for (const row of rows) {
    try {
      results.push(await reconcileFreightowerTrackingNotification(row.id));
    } catch (error) {
      results.push({
        processed: false,
        skipped: "error",
        error: error instanceof Error ? error.message : "物流通知处理失败",
      });
    }
  }
  return {
    scanned: rows.length,
    processed: results.filter((result) => result.processed).length,
    deferred: results.filter((result) => !result.processed).length,
    failed: results.filter((result) => result.skipped === "error").length,
    results,
  };
}
