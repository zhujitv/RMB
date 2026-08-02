import { assertWrite } from "./shared-auth";
import { codedError } from "./shared-base-utils";
import { getShipsgoIntegrationSettings } from "./freightower-integration";
import {
  assertShipsgoTrackingWriteAccess,
  cleanInputText,
  type ShipsgoActor,
} from "./shipsgo-tracking-utils";
import type { AuditRequestLike } from "./shipsgo-tracking-service-shared";
import { getTrackingForActor } from "./shipsgo-tracking-access";
import { syncLoadedShipsgoOceanTracking } from "./shipsgo-tracking-sync-operation";

export async function syncShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, trackingId: unknown) {
  assertWrite(actor, "domesticLogistics");
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要同步的飞驼可视跟踪记录。", 400, "FREIGHTOWER_TRACKING_REQUIRED");
  const settings = await getShipsgoIntegrationSettings();
  const before = await getTrackingForActor(id, actor);
  assertShipsgoTrackingWriteAccess(actor, before.order);
  return syncLoadedShipsgoOceanTracking(request, actor, before, settings);
}
