import { prisma } from "../prisma";
import { codedError } from "./shared-base-utils";
import { canAccessDomesticLogisticsOrder } from "./masters-access";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";
import { extractShipmentPayload, mapShipsgoShipmentPayload } from "./shipsgo-tracking-mapping";
import {
  OCEAN_MODE,
  SHIPSGO_PROVIDER,
  assertShipsgoOceanEnabled,
  cleanBookingNumber,
  cleanCarrierScac,
  cleanInputText,
  safeContainerNumber,
  shipsgoApiRequest,
  uniqueStrings,
  type ShipsgoActor,
  type ShipsgoSettings,
  type ShipsgoShipmentPayload,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";
import type { writeAudit } from "./shared-audit";

export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ShipsgoTrackingOrder = Awaited<ReturnType<typeof getShipsgoTrackingOrder>>;

export async function getShipsgoTrackingOrder(orderId: string, actor: ShipsgoActor) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      blNo: true,
      salespersonUserId: true,
      customerNameSnapshot: true,
      customer: { select: { salespersonUserId: true, shortName: true, name: true } },
      logisticsSuppliers: { select: { supplierId: true } },
      domesticLogisticsInfos: {
        where: { deletedAt: null },
        select: {
          id: true,
          transportItems: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: { containerNo: true, containerType: true },
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
      },
    },
  });
  if (!order) throw codedError("订单不存在或已删除。", 404, "ORDER_NOT_FOUND");
  if (!canAccessDomesticLogisticsOrder(actor, order)) {
    throw codedError("无权限访问该订单物流信息。", 403, "PERMISSION_DENIED");
  }
  return order;
}

export function orderContainerNumbers(order: ShipsgoTrackingOrder) {
  return uniqueStrings((order.domesticLogisticsInfos || []).flatMap((info) => (
    info.transportItems || []
  ).map((item) => safeContainerNumber(item.containerNo))));
}

function queryString(params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function shipmentHasUsefulIdentity(payload: ShipsgoShipmentPayload) {
  const mapped = mapShipsgoShipmentPayload(payload);
  return Boolean(mapped.shipsgoShipmentId || mapped.masterBlNo || mapped.bookingNumber || mapped.containerNumbers.length);
}

export async function findExistingShipsgoShipment(settings: ShipsgoSettings, target: { masterBlNo: string; carrierScac?: string; containerNumbers?: string[] }) {
  const candidates: string[] = [];
  const masterBlNo = target.masterBlNo;
  const carrier = target.carrierScac || "";
  if (masterBlNo) {
    candidates.push(`/ocean/shipments?${queryString({ booking_number: masterBlNo, carrier })}`);
    candidates.push(`/ocean/shipments?${queryString({ master_bl_no: masterBlNo, carrier })}`);
    candidates.push(`/ocean/shipments?${queryString({ mbl_number: masterBlNo, carrier })}`);
    candidates.push(`/ocean/shipments?${queryString({ reference: masterBlNo })}`);
  }
  for (const containerNo of target.containerNumbers || []) {
    candidates.push(`/ocean/shipments?${queryString({ container_number: containerNo })}`);
    candidates.push(`/ocean/shipments?${queryString({ container_no: containerNo })}`);
  }

  let lastMessage = "";
  for (const path of uniqueStrings(candidates)) {
    try {
      const response = await shipsgoApiRequest<unknown>(settings, path, { method: "GET" });
      const shipment = extractShipmentPayload(response.data);
      if (shipmentHasUsefulIdentity(shipment)) return { shipment, path };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "查询大掌櫃已有跟踪失败";
    }
  }
  throw codedError(
    lastMessage || "未在大掌櫃查询到已有跟踪，请确认提单号或柜号已在大掌櫃后台存在。",
    404,
    "SHIPSGO_EXISTING_TRACKING_NOT_FOUND",
  );
}

export function createPayloadFromInput(input: ShipsgoTrackingInput, order: ShipsgoTrackingOrder) {
  const carrierScac = cleanCarrierScac(input.carrierScac);
  const masterBlNo = cleanBookingNumber(order.blNo);
  if (!masterBlNo) {
    throw codedError("请先在物流信息中录入提单号后再开始追踪", 400, "SHIPSGO_MASTER_BL_REQUIRED");
  }
  const reference = cleanInputText(input.reference, 128)
    || cleanInputText(`${order.orderNo || order.id}-${masterBlNo}`, 128);
  if (reference && reference.length < 5) {
    throw codedError("大掌櫃 Reference 至少需要 5 个字符。", 400, "SHIPSGO_REFERENCE_TOO_SHORT");
  }
  return {
    reference,
    carrier: carrierScac || null,
    booking_number: masterBlNo,
    master_bl_no: masterBlNo,
  };
}

export async function replaceShipsgoTrackingContainers(trackingId: string, containerNumbers: string[]) {
  const cleanContainers = uniqueStrings(containerNumbers.map((containerNo) => safeContainerNumber(containerNo)));
  await prisma.$transaction([
    prisma.shipsgoTrackingContainer.deleteMany({ where: { trackingId } }),
    ...(cleanContainers.length ? [
      prisma.shipsgoTrackingContainer.createMany({
        data: cleanContainers.map((containerNo) => ({ trackingId, containerNo })),
        skipDuplicates: true,
      }),
    ] : []),
  ]);
}

export async function loadShipsgoTrackingWithContainers(id: string) {
  return prisma.shipsgoTracking.findUnique({
    where: { id },
    include: {
      containers: {
        select: { containerNo: true },
        orderBy: [{ containerNo: "asc" }],
      },
    },
  });
}
