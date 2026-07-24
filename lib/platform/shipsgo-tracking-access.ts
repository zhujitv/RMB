import { prisma } from "../prisma";
import { assertRead, assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";
import { codedError } from "./shared-base-utils";
import { canAccessDomesticLogisticsOrder } from "./masters-access";
import {
  FREIGHTOWER_PROVIDER,
  OCEAN_MODE,
  SHIPSGO_PROVIDER,
  actorId,
  assertShipsgoTrackingDeleteAccess,
  cleanInputText,
  safeContainerNumber,
  type ShipsgoActor,
} from "./shipsgo-tracking-utils";
import {
  loadShipsgoTrackingWithContainers,
  type AuditRequestLike,
} from "./shipsgo-tracking-service-shared";
import { serializeShipsgoTracking } from "./shipsgo-tracking-mapping";

export async function getTrackingForActor(id: string, actor: ShipsgoActor) {
  const tracking = await prisma.shipsgoTracking.findFirst({
    where: { id, deletedAt: null },
    include: {
      order: {
        select: {
          id: true,
          orderNo: true,
          blNo: true,
          customer: { select: { salespersonUserId: true } },
          logisticsSuppliers: { select: { supplierId: true } },
        },
      },
    },
  });
  if (!tracking) throw codedError("大掌櫃跟踪记录不存在。", 404, "SHIPSGO_TRACKING_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, tracking.order)) {
    throw codedError("无权限访问该大掌櫃跟踪记录。", 403, "PERMISSION_DENIED");
  }
  return tracking;
}

export async function getShipsgoOceanTracking(actor: ShipsgoActor, trackingId: unknown) {
  assertRead(actor, "domesticLogistics");
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要查看的大掌櫃跟踪记录。", 400, "SHIPSGO_TRACKING_REQUIRED");
  const allowedTracking = await getTrackingForActor(id, actor);
  const tracking = await loadShipsgoTrackingWithContainers(allowedTracking.id);
  if (!tracking) throw codedError("大掌櫃跟踪记录不存在。", 404, "SHIPSGO_TRACKING_NOT_FOUND");
  return { tracking: serializeShipsgoTracking(tracking) };
}

export async function deleteShipsgoOceanTracking(request: AuditRequestLike, actor: ShipsgoActor, trackingId: unknown) {
  assertWrite(actor, "domesticLogistics");
  assertShipsgoTrackingDeleteAccess(actor);
  const id = cleanInputText(trackingId, 80);
  if (!id) throw codedError("请选择需要删除的大掌櫃跟踪记录。", 400, "SHIPSGO_TRACKING_REQUIRED");
  const before = await getTrackingForActor(id, actor);
  const now = new Date();
  const saved = await prisma.shipsgoTracking.update({
    where: { id: before.id },
    data: {
      deletedAt: now,
      updatedById: actorId(actor) || null,
    },
  });
  await runNonCriticalTask("大掌櫃跟踪删除日志写入", () => writeAudit(
    request,
    actor,
    "删除大掌櫃海运跟踪",
    "shipsgo_trackings",
    saved.id,
    {
      status: before.status,
      syncStatus: before.syncStatus,
      shipsgoShipmentId: before.shipsgoShipmentId,
      masterBlNo: before.masterBlNo || before.bookingNumber,
    },
    { deletedAt: saved.deletedAt },
  ));
  return { id: saved.id, message: "大掌櫃跟踪已删除。" };
}

export async function findShipsgoOceanTrackingByContainerNo(actor: ShipsgoActor, containerNoInput: unknown) {
  const containerNo = safeContainerNumber(containerNoInput);
  if (!containerNo) throw codedError("请输入正确的柜号，例如 MSKU1234567。", 400, "SHIPSGO_INVALID_CONTAINER");
  const row = await prisma.shipsgoTrackingContainer.findFirst({
    where: {
      containerNo,
      tracking: {
        provider: { in: [SHIPSGO_PROVIDER, FREIGHTOWER_PROVIDER] },
        mode: OCEAN_MODE,
        deletedAt: null,
      },
    },
    include: {
      tracking: {
        include: {
          containers: {
            select: { containerNo: true },
            orderBy: [{ containerNo: "asc" }],
          },
          order: {
            select: {
              id: true,
              orderNo: true,
              blNo: true,
              customer: { select: { salespersonUserId: true } },
              logisticsSuppliers: { select: { supplierId: true } },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  if (!row) {
    throw codedError("本地未找到该柜号对应的大掌櫃跟踪，请管理员先同步已有提单跟踪。", 404, "SHIPSGO_CONTAINER_NOT_FOUND");
  }
  if (!canAccessDomesticLogisticsOrder(actor, row.tracking.order)) {
    throw codedError("无权限访问该柜号对应的大掌櫃跟踪。", 403, "PERMISSION_DENIED");
  }
  return { tracking: serializeShipsgoTracking(row.tracking), message: "已从本地柜号关联返回大掌櫃跟踪。" };
}
