import crypto from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { codedError, isPlainRecord, nonEmpty, num } from "./shared-base-utils";
import { timingSafeEqualText } from "./shared-auth";
import {
  arrayAt,
  arrayByKeys,
  dateAt,
  dateByKeys,
  recordAt,
  textAt,
  textByKeys,
} from "./shipsgo-tracking-mapping-helpers";
import {
  cleanBookingNumber,
  cleanInputText,
  safeContainerNumber,
  safeJsonParse,
  uniqueStrings,
  type ShipsgoSettings,
  type ShipsgoShipmentPayload,
  type ShipsgoTrackingInput,
} from "./shipsgo-tracking-utils";
import type { ShipsgoTrackingOrder } from "./shipsgo-tracking-service-shared";

type FreightowerTokenCache = {
  token: string;
  tokenType: string;
  expiresAt: number;
};

let tokenCache: FreightowerTokenCache | null = null;

function freightowerApiBaseUrl(settings: ShipsgoSettings) {
  return String(settings.freightowerApiBaseUrl || "http://openapi.freightower.com").replace(/\/+$/, "");
}

function cleanFreightowerCode(value: unknown, limit = 32) {
  return cleanInputText(value, limit).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function cleanFreightowerBusinessNo(value: unknown) {
  return cleanInputText(value, 128).replace(/[#&?/]/g, "-");
}

function responseStatusCode(data: unknown) {
  const status = isPlainRecord(data) ? data.statusCode ?? recordAt(data, "data").statusCode : "";
  return String(status || "");
}

function responseMessage(data: unknown) {
  if (!isPlainRecord(data)) return "";
  return nonEmpty(data.message || data.alertMessage || recordAt(data, "data").message);
}

function freightowerApiErrorMessage(path: string, responseStatus: number, data: unknown) {
  const statusCode = responseStatusCode(data);
  if (statusCode === "40300" || responseStatus === 403) {
    return `飞驼可视接口拒绝当前请求：${path} 返回 ${statusCode || responseStatus}。请联系飞驼确认该 Client ID 的应用接口授权、服务器出口 IP 白名单和集装箱综合跟踪查询接口权限。`;
  }
  if (statusCode === "40100" || responseStatus === 401) {
    return "飞驼可视登录状态已失效，请重新获取 Token 后再试。";
  }
  const message = responseMessage(data);
  const codeSuffix = statusCode ? `（statusCode ${statusCode}）` : "";
  return message ? `${message}${codeSuffix}` : `飞驼可视请求失败${codeSuffix}。`;
}

function isTokenExpiredResponse(data: unknown) {
  return responseStatusCode(data) === "40100";
}

function isFreightowerSuccessStatus(statusCode: string) {
  return !statusCode || statusCode === "20000" || statusCode === "20001";
}

async function getFreightowerToken(settings: ShipsgoSettings, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && tokenCache?.token && tokenCache.expiresAt > now + 60_000) return tokenCache;
  const response = await fetch(`${freightowerApiBaseUrl(settings)}/auth/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      clientId: settings.freightowerClientId,
      secret: settings.freightowerSecret,
    }),
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};
  const tokenData = recordAt(data, "data");
  const accessToken = textAt(tokenData, "access_token") || textAt(data, "access_token");
  if (!response.ok || !accessToken) {
    throw codedError(responseMessage(data) || "飞驼可视 Token 获取失败。", response.status >= 500 ? 502 : 400, "FREIGHTOWER_TOKEN_FAILED");
  }
  const expiresInSeconds = num(textAt(tokenData, "expires_in") || textAt(data, "expires_in"), 3600);
  tokenCache = {
    token: accessToken,
    tokenType: textAt(tokenData, "token_type") || textAt(data, "token_type") || "bearer",
    expiresAt: now + Math.max(300, expiresInSeconds) * 1000,
  };
  return tokenCache;
}

export async function freightowerApiRequest<T>(
  settings: ShipsgoSettings,
  path: string,
  body: Record<string, unknown>,
  forceTokenRefresh = false,
): Promise<T> {
  const token = await getFreightowerToken(settings, forceTokenRefresh);
  const response = await fetch(`${freightowerApiBaseUrl(settings)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `${token.tokenType} ${token.token}`,
      access_token: token.token,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};
  if (isTokenExpiredResponse(data) && !forceTokenRefresh) {
    tokenCache = null;
    return freightowerApiRequest<T>(settings, path, body, true);
  }
  const statusCode = responseStatusCode(data);
  if (!response.ok || !isFreightowerSuccessStatus(statusCode)) {
    throw codedError(freightowerApiErrorMessage(path, response.status, data), response.status >= 500 ? 502 : 400, "FREIGHTOWER_API_ERROR");
  }
  return data as T;
}

export function assertFreightowerOceanEnabled(settings: ShipsgoSettings) {
  if (!settings.enabled) throw codedError("物流跟踪接口未启用。", 400, "TRACKING_INTEGRATION_DISABLED");
  if (!settings.freightowerEnabled) throw codedError("飞驼可视接口未启用。", 400, "FREIGHTOWER_PROVIDER_DISABLED");
  if (!settings.freightowerClientId || !settings.freightowerSecret) {
    throw codedError("飞驼可视 Client ID 或 Secret 未配置。", 400, "FREIGHTOWER_CREDENTIAL_REQUIRED");
  }
  if (!settings.oceanTrackingEnabled) throw codedError("飞驼可视海运跟踪功能未启用。", 400, "FREIGHTOWER_OCEAN_DISABLED");
}

export function createFreightowerPayloadFromInput(input: ShipsgoTrackingInput, order: ShipsgoTrackingOrder, settings: ShipsgoSettings) {
  const billNo = cleanBookingNumber(order.blNo);
  const localContainerNo = uniqueStrings((order.domesticLogisticsInfos || []).flatMap((info) => (
    info.transportItems || []
  ).map((item) => safeContainerNumber(item.containerNo))))[0] || "";
  const carrierCode = cleanFreightowerCode(input.carrierScac, 32) || settings.freightowerDefaultCarrierCode || "AUTO";
  const portCode = cleanFreightowerCode(input.portCode, 16) || settings.freightowerDefaultPortCode || "";
  const isExport = cleanFreightowerCode(input.isExport, 1) || settings.freightowerDefaultIsExport || "";
  if (!billNo && !localContainerNo) {
    throw codedError("请先录入提单号或柜号后再使用飞驼可视追踪。", 400, "FREIGHTOWER_TARGET_REQUIRED");
  }
  if (!carrierCode && !portCode) {
    throw codedError("飞驼可视需要船公司代码或港区代码，请在后台设置默认值。", 400, "FREIGHTOWER_PROVIDER_CODE_REQUIRED");
  }
  return {
    billNo,
    containerNo: safeContainerNumber(input.containerNo) || localContainerNo,
    carrierCode,
    portCode,
    isExport,
    businessNo: cleanFreightowerBusinessNo(input.reference || `${order.orderNo || order.id}-${billNo || localContainerNo}`),
    billCategory: cleanFreightowerCode(input.billCategory, 2),
    polCode: cleanFreightowerCode(input.polCode, 16),
    podCode: cleanFreightowerCode(input.podCode, 16),
  };
}

export function createFreightowerPayloadFromTracking(row: {
  masterBlNo?: string | null;
  bookingNumber?: string | null;
  containerNumber?: string | null;
  reference?: string | null;
  carrierScac?: string | null;
}, settings: ShipsgoSettings) {
  const billNo = cleanBookingNumber(row.masterBlNo || row.bookingNumber);
  const containerNo = safeContainerNumber(row.containerNumber);
  if (!billNo && !containerNo) {
    throw codedError("本地缺少飞驼可视同步所需的提单号或柜号。", 400, "FREIGHTOWER_SYNC_TARGET_REQUIRED");
  }
  return {
    billNo,
    containerNo,
    carrierCode: cleanFreightowerCode(row.carrierScac, 32) || settings.freightowerDefaultCarrierCode || "AUTO",
    portCode: settings.freightowerDefaultPortCode || "",
    isExport: settings.freightowerDefaultIsExport || "",
    businessNo: cleanFreightowerBusinessNo(row.reference || billNo || containerNo),
    billCategory: "",
    polCode: "",
    podCode: "",
  };
}

function resultFromFreightowerPayload(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const dataResult = recordAt(data, "result");
  if (Object.keys(dataResult).length) return dataResult;
  const rootResult = recordAt(root, "result");
  if (Object.keys(rootResult).length) return rootResult;
  return root;
}

function paramFromFreightowerPayload(payload: unknown) {
  const root = isPlainRecord(payload) ? payload : {};
  const data = recordAt(root, "data");
  const query = recordAt(data, "query");
  const actualParam = recordAt(query, "actualParam");
  if (Object.keys(actualParam).length) return actualParam;
  const param = recordAt(query, "param");
  if (Object.keys(param).length) return param;
  return recordAt(root, "param");
}

function freightowerPlaceLabel(place: unknown) {
  return textAt(place, "nameCn") || textAt(place, "name") || textAt(place, "nameOrigin") || textAt(place, "code");
}

function placeByTypes(places: unknown[], types: number[]) {
  return places.find((place) => types.includes(num(textAt(place, "type"), num(isPlainRecord(place) ? place.type : "", 0)))) || {};
}

function newestStatus(statuses: unknown[]) {
  return statuses
    .map((status) => ({ status, time: dateAt(status, "eventTime") }))
    .filter((item): item is { status: unknown; time: Date } => Boolean(item.time))
    .sort((a, b) => b.time.getTime() - a.time.getTime())[0]?.status || statuses[statuses.length - 1] || {};
}

function firstContainer(result: ShipsgoShipmentPayload) {
  return arrayAt(result, "containers")[0] || {};
}

function freightowerMapUrl(settings: ShipsgoSettings, param: Record<string, unknown>) {
  if (!settings.freightowerMapKey || !settings.freightowerClientId) return "";
  const search = new URLSearchParams();
  search.set("key", settings.freightowerMapKey);
  search.set("clientId", settings.freightowerClientId);
  const params = ["billNo", "containerNo", "carrierCode", "portCode", "isExport", "businessNo", "billCategory", "polCode", "podCode"];
  for (const key of params) {
    const value = cleanInputText(param[key], 128);
    if (value) search.set(key, value);
  }
  search.set("showInfo", "1");
  search.set("lang", settings.freightowerDefaultLang || "zh");
  search.set("hiddenReference", settings.freightowerHiddenReference ? "1" : "0");
  return `https://i.saas.freightower.com/#/ocean/detail?${search.toString()}`;
}

export function mapFreightowerShipmentPayload(payload: unknown, settings?: ShipsgoSettings) {
  const result = resultFromFreightowerPayload(payload) as ShipsgoShipmentPayload;
  const param = paramFromFreightowerPayload(payload);
  const carrier = recordAt(result, "carrier");
  const booking = recordAt(result, "booking");
  const firstVessel = recordAt(result, "firstVessel");
  const current = recordAt(result, "currentStatus");
  const places = arrayAt(result, "places");
  const originPlace = placeByTypes(places, [1, 2]);
  const destinationPlace = placeByTypes(places, [4, 5]) || places[places.length - 1] || {};
  const container = firstContainer(result);
  const containerStatuses = arrayAt(container, "status");
  const latestContainerStatus = newestStatus(containerStatuses);
  const statusDescription = textAt(current, "descriptionCn")
    || textAt(latestContainerStatus, "descriptionCn")
    || textAt(result, "statusDescription")
    || textAt(result, "statusCategory")
    || "UNKNOWN";
  const billNo = textAt(result, "billNo") || textAt(param, "billNo");
  const containerNumbers = uniqueStrings([
    safeContainerNumber(textAt(result, "containerNo")),
    safeContainerNumber(textAt(param, "containerNo")),
    ...arrayAt(result, "containers").map((item) => safeContainerNumber(textAt(item, "containerNo"))),
  ]);
  return {
    shipsgoShipmentId: cleanInputText(`${billNo || containerNumbers[0] || textAt(param, "businessNo") || "freightower"}:${textAt(param, "carrierCode") || textAt(carrier, "code")}`, 160),
    masterBlNo: billNo,
    reference: textAt(param, "businessNo"),
    carrierScac: textAt(carrier, "code") || textAt(param, "carrierCode"),
    carrierName: textAt(carrier, "nameCn") || textAt(carrier, "nameEn") || textAt(carrier, "code") || textAt(param, "carrierCode"),
    bookingNumber: billNo,
    containerNumber: containerNumbers[0] || "",
    status: textAt(result, "statusCategory") || "UNKNOWN",
    currentStatus: statusDescription,
    syncStatus: "SYNCED",
    syncMessage: responseMessage(payload),
    originName: freightowerPlaceLabel(originPlace),
    destinationName: freightowerPlaceLabel(destinationPlace),
    originPortCode: textAt(originPlace, "code"),
    destinationPortCode: textAt(destinationPlace, "code"),
    dateOfLoading: dateAt(originPlace, "atd") || dateAt(originPlace, "load") || dateAt(originPlace, "etd") || dateAt(originPlace, "std"),
    dateOfDischarge: dateAt(destinationPlace, "ata") || dateAt(destinationPlace, "disc"),
    predictedDischargeDate: dateAt(destinationPlace, "eta_predicted") || dateAt(destinationPlace, "eta") || dateByKeys(result, ["eta_predicted", "podEtaPredicted"]),
    eta: dateAt(destinationPlace, "eta_predicted") || dateAt(destinationPlace, "eta") || dateAt(current, "eventTime"),
    vesselName: textAt(current, "vslName") || textAt(latestContainerStatus, "vslName") || textAt(firstVessel, "vessel") || textAt(originPlace, "vessel") || textAt(destinationPlace, "vessel"),
    voyage: textAt(current, "voy") || textAt(latestContainerStatus, "voy") || textAt(originPlace, "voyage") || textAt(destinationPlace, "voyage"),
    mapToken: "",
    mapUrl: settings ? freightowerMapUrl(settings, param) : "",
    lastEvent: statusDescription,
    lastEventAt: dateAt(current, "eventTime") || dateAt(latestContainerStatus, "eventTime") || dateAt(result, "updateTime"),
    containerNumbers,
    rawPayload: result as Prisma.InputJsonValue,
    rawResponse: payload as Prisma.InputJsonValue,
  };
}

export function trackingDataFromFreightowerMappedShipment(mapped: ReturnType<typeof mapFreightowerShipmentPayload>) {
  const {
    containerNumbers: _containerNumbers,
    originPortCode: _originPortCode,
    destinationPortCode: _destinationPortCode,
    ...trackingData
  } = mapped;
  return trackingData;
}

export function verifyFreightowerWebhookSignature(settings: ShipsgoSettings, rawBody: string, headers: Headers) {
  if (!settings.freightowerWebhookSecret) return true;
  const timestamp = nonEmpty(headers.get("x-ft-timestamp"));
  const nonce = nonEmpty(headers.get("x-ft-nonce"));
  const client = nonEmpty(headers.get("x-ft-client"));
  const signature = nonEmpty(headers.get("x-ft-signature"));
  if (!timestamp || !nonce || !client || !signature) return false;
  const expected = crypto
    .createHmac("sha1", settings.freightowerWebhookSecret)
    .update(`${timestamp}/${nonce}/${client}/${rawBody}`)
    .digest("base64");
  return timingSafeEqualText(signature, expected);
}
