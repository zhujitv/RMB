import {
  codedError,
  isPlainRecord,
  nonEmpty,
  num,
} from "./shared-base-utils";
import { getShipsgoIntegrationSettings } from "./shipsgo-integration";

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

type ShipsgoApiResponse<T> = {
  status: number;
  data: T;
  headers: Headers;
};

export type ShipsgoShipmentPayload = Record<string, unknown>;

export type ShipsgoQueryLike = {
  get(key: string): string | null;
} | null | undefined;

export const SHIPSGO_PROVIDER = "SHIPSGO";
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
  order: { customer?: { salespersonUserId?: string | null } | null } | null | undefined,
) {
  const role = actorRole(actor);
  if (role === "管理员") return;
  if (role === "业务员" && order?.customer?.salespersonUserId === actorId(actor)) return;
  throw codedError("当前角色不允许创建、同步或删除大掌櫃跟踪。", 403, "SHIPSGO_TRACKING_WRITE_FORBIDDEN");
}

export function assertShipsgoTrackingDeleteAccess(actor: ShipsgoActor) {
  if (actorRole(actor) === "管理员") return;
  throw codedError("只有管理员可以删除大掌櫃跟踪。", 403, "SHIPSGO_TRACKING_DELETE_ADMIN_ONLY");
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
    throw codedError("船公司代码应为大掌櫃支持的 SCAC 代码，例如 MAEU / CMDU。", 400, "SHIPSGO_INVALID_CARRIER");
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
    throw codedError("提单号 / Booking No. 仅支持字母、数字、斜杠和横线。", 400, "SHIPSGO_INVALID_BOOKING");
  }
  return text;
}

export function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function shipsgoApiBaseUrl(settings: ShipsgoSettings) {
  const base = String(settings.apiBaseUrl || "https://api.shipsgo.com").replace(/\/+$/, "");
  return base.endsWith("/v2") ? base : `${base}/v2`;
}

export function assertShipsgoOceanEnabled(settings: ShipsgoSettings) {
  if (!settings.enabled) throw codedError("大掌櫃集成未启用。", 400, "SHIPSGO_DISABLED");
  if (!settings.apiKey) throw codedError("大掌櫃 API Key 未配置。", 400, "SHIPSGO_API_KEY_REQUIRED");
  if (!settings.oceanTrackingEnabled) throw codedError("大掌櫃海运跟踪功能未启用。", 400, "SHIPSGO_OCEAN_DISABLED");
}

export async function shipsgoApiRequest<T>(
  settings: ShipsgoSettings,
  path: string,
  options: RequestInit = {},
  allowConflict = false,
): Promise<ShipsgoApiResponse<T>> {
  const response = await fetch(`${shipsgoApiBaseUrl(settings)}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Shipsgo-User-Token": settings.apiKey,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};
  if (!response.ok && !(allowConflict && response.status === 409)) {
    throw codedError(shipsgoApiErrorMessage(response.status, data), shipsgoApiErrorStatus(response.status), "SHIPSGO_API_ERROR");
  }
  return { status: response.status, data: data as T, headers: response.headers };
}

export function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

function shipsgoResponseMessage(data: unknown) {
  if (!isPlainRecord(data)) return "";
  return nonEmpty(data.message || data.error || data.detail || data.title);
}

function shipsgoApiErrorStatus(status: number) {
  if (status === 401 || status === 403) return 400;
  if (status === 402) return 402;
  if (status === 429) return 429;
  if (status >= 500) return 502;
  return 400;
}

function shipsgoApiErrorMessage(status: number, data: unknown) {
  const detail = shipsgoResponseMessage(data);
  if (status === 401 || status === 403) return "大掌櫃 API Key 无效或权限不足。";
  if (status === 402) return "大掌櫃 Credit 不足，请先充值或调整跟踪数量。";
  if (status === 429) return "大掌櫃请求频率过高，请稍后再试。";
  if (status >= 500) return "大掌櫃服务暂时不可用，请稍后再试。";
  return detail || "大掌櫃请求失败。";
}

export function shipsgoRateLimitSummary(headers: Headers) {
  return {
    limit: num(headers.get("X-RateLimit-Limit"), 0),
    remaining: num(headers.get("X-RateLimit-Remaining"), 0),
    reset: nonEmpty(headers.get("X-RateLimit-Reset")),
  };
}
