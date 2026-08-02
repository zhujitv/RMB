import {
  codedError,
  nonEmpty,
} from "./shared-base-utils";
import { getShipsgoIntegrationSettings } from "./freightower-integration";

export type ShipsgoActor = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type ShipsgoTrackingInput = Record<string, unknown> & {
  orderId?: unknown;
  masterBlNo?: unknown;
  carrierScac?: unknown;
  bookingNumber?: unknown;
  reference?: unknown;
};

export type ShipsgoSettings = Awaited<ReturnType<typeof getShipsgoIntegrationSettings>>;

export type ShipsgoShipmentPayload = Record<string, unknown>;

export type ShipsgoQueryLike = {
  get(key: string): string | null;
} | null | undefined;

export const FREIGHTOWER_PROVIDER = "FREIGHTOWER";
export const OCEAN_MODE = "OCEAN";
const CONTAINER_PATTERN = /^[A-Z]{4}[0-9]{7}$/;
const CARRIER_PATTERN = /^(SG_)?[A-Z0-9]{4}$/;

export function actorId(actor: ShipsgoActor) {
  return nonEmpty(actor?.id);
}

export function actorRole(actor: ShipsgoActor) {
  return nonEmpty(actor?.role);
}

export function assertShipsgoTrackingWriteAccess(
  actor: ShipsgoActor,
  order: { salespersonUserId?: string | null; customer?: { salespersonUserId?: string | null } | null } | null | undefined,
) {
  const role = actorRole(actor);
  if (role === "管理员") return;
  if (role === "业务员" && orderBelongsToSalesperson(order, actorId(actor))) return;
  throw codedError("当前角色不允许创建、同步或删除飞驼可视跟踪。", 403, "FREIGHTOWER_TRACKING_WRITE_FORBIDDEN");
}

function orderBelongsToSalesperson(
  order: { salespersonUserId?: string | null; customer?: { salespersonUserId?: string | null } | null } | null | undefined,
  currentActorId: string,
) {
  if (!order || !currentActorId) return false;
  if (order.salespersonUserId) return order.salespersonUserId === currentActorId;
  return order.customer?.salespersonUserId === currentActorId;
}

export function assertShipsgoTrackingDeleteAccess(actor: ShipsgoActor) {
  if (actorRole(actor) === "管理员") return;
  throw codedError("只有管理员可以删除飞驼可视跟踪。", 403, "FREIGHTOWER_TRACKING_DELETE_ADMIN_ONLY");
}

export function cleanInputText(value: unknown, limit = 128) {
  return nonEmpty(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

export function cleanCarrierScac(value: unknown) {
  const text = cleanInputText(value, 8).toUpperCase();
  if (text && !CARRIER_PATTERN.test(text)) {
    throw codedError("船公司代码格式不正确，例如 MAEU / CMDU。", 400, "FREIGHTOWER_INVALID_CARRIER");
  }
  return text;
}

export function safeContainerNumber(value: unknown) {
  const text = cleanInputText(value, 24).toUpperCase();
  return CONTAINER_PATTERN.test(text) ? text : "";
}

export function cleanBookingNumber(value: unknown) {
  const text = cleanInputText(value, 64);
  if (text && !/^[a-zA-Z0-9/-]+$/.test(text)) {
    throw codedError("提单号仅支持字母、数字、斜杠和横线。", 400, "FREIGHTOWER_INVALID_BOOKING");
  }
  return text;
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function assertActiveOceanTrackingEnabled(settings: ShipsgoSettings) {
  if (!settings.enabled) throw codedError("物流跟踪接口未启用。", 400, "TRACKING_INTEGRATION_DISABLED");
  if (!settings.oceanTrackingEnabled) throw codedError("海运跟踪功能未启用。", 400, "OCEAN_TRACKING_DISABLED");
  if (!settings.freightowerApiKey) {
    throw codedError("飞驼可视 API Key 未配置。", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  return FREIGHTOWER_PROVIDER;
}

export function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}
