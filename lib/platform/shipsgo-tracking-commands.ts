import { assertWrite } from "./shared-auth";
import { codedError } from "./shared-base-utils";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import {
  FREIGHTOWER_PROVIDER,
  assertShipsgoTrackingWriteAccess,
  cleanInputText,
  type ShipsgoActor,
} from "./shipsgo-tracking-utils";
import type { AuditRequestLike } from "./shipsgo-tracking-service-shared";
import { getTrackingForActor } from "./shipsgo-tracking-access";
import { recoverShipsgoOceanTracking } from "./shipsgo-tracking-recovery";
import { syncLoadedShipsgoOceanTracking } from "./shipsgo-tracking-sync-operation";

export async function syncShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, trackingId: unknown) {
  assertWrite(actor, "domesticLogistics");
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要同步的大掌櫃跟踪记录。", 400, "SHIPSGO_TRACKING_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  const before = await getTrackingForActor(id, actor);
  assertShipsgoTrackingWriteAccess(actor, before.order);
  if (before.provider !== FREIGHTOWER_PROVIDER && !before.shipsgoShipmentId) {
    return recoverShipsgoOceanTracking(request, actor, {
      orderId: before.orderId,
      masterBlNo: before.masterBlNo || before.bookingNumber,
      carrierScac: before.carrierScac,
    });
  }
  return syncLoadedShipsgoOceanTracking(request, actor, before, settings);
}
