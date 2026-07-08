import crypto from "node:crypto";
import { prisma } from "../prisma";
import { assertJsonObject, codedError, nonEmpty } from "./shared-base-utils";
import { assertWrite, timingSafeEqualText } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import {
  assertFreightowerOceanEnabled,
  createFreightowerPayloadFromTracking,
  freightowerApiRequest,
  mapFreightowerShipmentPayload,
  trackingDataFromFreightowerMappedShipment,
  verifyFreightowerWebhookSignature,
} from "./freightower-tracking";
import { extractShipmentPayload, mapShipsgoShipmentPayload, recursiveShipmentId, serializeShipsgoTracking, textAt, trackingDataFromMappedShipment } from "./shipsgo-tracking-mapping";
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  SHIPSGO_PROVIDER,
  actorId,
  assertActiveOceanTrackingEnabled,
  assertShipsgoOceanEnabled,
  safeJsonParse,
  shipsgoApiRequest,
  type ShipsgoActor,
} from "./shipsgo-tracking-utils";
import { loadShipsgoTrackingWithContainers, replaceShipsgoTrackingContainers, type AuditRequestLike } from "./shipsgo-tracking-service-shared";

export async function syncDueShipsgoOceanTrackings(request: AuditRequestLike, actor: ShipsgoActor, options: { limit?: number; now?: Date } = {}) {
  assertWrite(actor, "domesticLogistics");
  const settings = await getShipsgoIntegrationSettings();
  const provider = assertActiveOceanTrackingEnabled(settings);
  const now = options.now || new Date();
  const cutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit || 50)));
  const rows = await prisma.shipsgoTracking.findMany({
    where: {
      provider,
      mode: OCEAN_MODE,
      deletedAt: null,
      ...(provider === SHIPSGO_PROVIDER ? { shipsgoShipmentId: { not: null } } : {}),
      OR: [
        { lastSyncTime: null },
        { lastSyncTime: { lt: cutoff } },
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: cutoff } },
      ],
    },
    orderBy: [{ lastSyncTime: "asc" }, { lastSyncedAt: "asc" }, { updatedAt: "asc" }],
    take: limit,
  });
  const results: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const row of rows) {
    try {
      const mapped = provider === FREIGHTOWER_PROVIDER
        ? mapFreightowerShipmentPayload(
          await freightowerApiRequest<unknown>(settings, "/application/v1/query", createFreightowerPayloadFromTracking(row, settings)),
          settings,
        )
        : mapShipsgoShipmentPayload(extractShipmentPayload(
          (await shipsgoApiRequest<unknown>(settings, `/ocean/shipments/${encodeURIComponent(row.shipsgoShipmentId || "")}`)).data,
        ));
      const trackingData = provider === FREIGHTOWER_PROVIDER
        ? trackingDataFromFreightowerMappedShipment(mapped as ReturnType<typeof mapFreightowerShipmentPayload>)
        : trackingDataFromMappedShipment(mapped as ReturnType<typeof mapShipsgoShipmentPayload>);
      const savedBase = await prisma.shipsgoTracking.update({
        where: { id: row.id },
        data: {
          ...trackingData,
          masterBlNo: mapped.masterBlNo || row.masterBlNo || row.bookingNumber,
          containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || row.containerNumber,
          eta: mapped.eta,
          currentStatus: mapped.currentStatus,
          syncStatus: "SYNCED",
          syncMessage: "",
          lastCheckedAt: now,
          lastSyncedAt: now,
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      });
      await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
      results.push({ id: row.id, ok: true, message: "同步成功" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      await prisma.shipsgoTracking.update({
        where: { id: row.id },
        data: {
          syncStatus: "SYNC_FAILED",
          syncMessage: message.slice(0, 500),
          lastCheckedAt: now,
          lastSyncTime: now,
          updatedById: actorId(actor) || null,
        },
      }).catch(() => null);
      results.push({ id: row.id, ok: false, message });
    }
  }
  await runNonCriticalTask("大掌櫃定时同步日志写入", () => writeAudit(
    request,
    actor,
    "定时同步大掌櫃海运跟踪",
    "shipsgo_trackings",
    "cron",
    null,
    { provider, total: rows.length, success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length },
  ));
  return {
    success: true,
    total: rows.length,
    successCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    results,
  };
}

export async function handleShipsgoWebhook(rawBody: string, signature: unknown, headers?: Headers) {
  const settings = await getShipsgoIntegrationSettings();
  if (settings.activeProvider === FREIGHTOWER_PROVIDER) {
    assertFreightowerOceanEnabled(settings);
    if (!settings.webhookEnabled) throw codedError("飞驼可视推送未启用。", 400, "FREIGHTOWER_WEBHOOK_DISABLED");
    if (headers && !verifyFreightowerWebhookSignature(settings, rawBody, headers)) {
      throw codedError("飞驼可视推送签名校验失败。", 401, "FREIGHTOWER_WEBHOOK_SIGNATURE_INVALID");
    }
    const payload = safeJsonParse(rawBody);
    const mapped = mapFreightowerShipmentPayload(payload, settings);
    const targetShipmentId = mapped.shipsgoShipmentId;
    const targetWhere: Array<{ shipsgoShipmentId?: string; masterBlNo?: string; bookingNumber?: string; containerNumber?: string }> = [];
    if (targetShipmentId) targetWhere.push({ shipsgoShipmentId: targetShipmentId });
    if (mapped.masterBlNo) targetWhere.push({ masterBlNo: mapped.masterBlNo });
    if (mapped.bookingNumber) targetWhere.push({ bookingNumber: mapped.bookingNumber });
    if (mapped.containerNumber) targetWhere.push({ containerNumber: mapped.containerNumber });
    const before = await prisma.shipsgoTracking.findFirst({
      where: {
        provider: FREIGHTOWER_PROVIDER,
        deletedAt: null,
        OR: targetWhere,
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    if (!before) return { success: true, ignored: true, message: "本地未找到对应飞驼可视跟踪，已忽略。" };
    const trackingData = trackingDataFromFreightowerMappedShipment(mapped);
    const now = new Date();
    const savedBase = await prisma.shipsgoTracking.update({
      where: { id: before.id },
      data: {
        ...trackingData,
        shipsgoShipmentId: mapped.shipsgoShipmentId || targetShipmentId,
        masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
        containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
        eta: mapped.eta,
        currentStatus: mapped.currentStatus,
        syncStatus: "WEBHOOK_SYNCED",
        syncMessage: "",
        lastCheckedAt: now,
        lastSyncedAt: now,
        lastSyncTime: now,
      },
    });
    await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
    const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
    if (!saved) throw codedError("飞驼可视推送同步保存失败。", 500, "FREIGHTOWER_TRACKING_SAVE_FAILED");
    return { success: true, tracking: serializeShipsgoTracking(saved) };
  }

  if (!settings.enabled || !settings.webhookEnabled) {
    throw codedError("大掌櫃 Webhook 未启用。", 400, "SHIPSGO_WEBHOOK_DISABLED");
  }
  if (!settings.webhookSecret) {
    throw codedError("大掌櫃 Webhook Secret 未配置。", 400, "SHIPSGO_WEBHOOK_SECRET_REQUIRED");
  }
  const expected = crypto.createHmac("sha256", settings.webhookSecret).update(rawBody).digest("hex");
  if (!timingSafeEqualText(nonEmpty(signature), expected)) {
    throw codedError("大掌櫃 Webhook 签名校验失败。", 401, "SHIPSGO_WEBHOOK_SIGNATURE_INVALID");
  }
  const payload = safeJsonParse(rawBody);
  const shipmentPayload = extractShipmentPayload(payload);
  const shipmentId = textAt(shipmentPayload, "id") || recursiveShipmentId(payload);
  if (!shipmentId) {
    return { success: true, ignored: true, message: "未找到 Shipment ID，已忽略。" };
  }
  const before = await prisma.shipsgoTracking.findFirst({
    where: { provider: SHIPSGO_PROVIDER, shipsgoShipmentId: shipmentId, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (!before) return { success: true, ignored: true, message: "本地未找到对应大掌櫃跟踪，已忽略。" };
  const mapped = mapShipsgoShipmentPayload(shipmentPayload);
  const trackingData = trackingDataFromMappedShipment(mapped);
  const now = new Date();
  const savedBase = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      ...trackingData,
      shipsgoShipmentId: mapped.shipsgoShipmentId || shipmentId,
      masterBlNo: mapped.masterBlNo || before.masterBlNo || before.bookingNumber,
      containerNumber: mapped.containerNumber || mapped.containerNumbers[0] || before.containerNumber,
      eta: mapped.eta,
      currentStatus: mapped.currentStatus,
      syncStatus: "WEBHOOK_SYNCED",
      syncMessage: "",
      lastCheckedAt: now,
      lastSyncedAt: now,
      lastSyncTime: now,
    },
  });
  await replaceShipsgoTrackingContainers(savedBase.id, mapped.containerNumbers);
  const saved = await loadShipsgoTrackingWithContainers(savedBase.id);
  if (!saved) throw codedError("大掌櫃 Webhook 同步保存失败。", 500, "SHIPSGO_TRACKING_SAVE_FAILED");
  return { success: true, tracking: serializeShipsgoTracking(saved) };
}
