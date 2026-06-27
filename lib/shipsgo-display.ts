export type ShipsgoDisplayLocale = "zh-CN" | "en" | "ru" | "de" | "fr" | "es";

type LocalizedLabels = Partial<Record<ShipsgoDisplayLocale, string>>;

type CarrierDisplayEntry = {
  aliases: string[];
  canonical: string;
  labels: LocalizedLabels;
};

type PortDisplayEntry = {
  codes: string[];
  aliases: string[];
  labels: LocalizedLabels;
};

type StatusDisplayEntry = {
  aliases: string[];
  labels: LocalizedLabels;
};

const DEFAULT_LOCALE: ShipsgoDisplayLocale = "en";
const SUPPORTED_LOCALES = new Set<ShipsgoDisplayLocale>(["zh-CN", "en", "ru", "de", "fr", "es"]);

const CARRIER_DISPLAY_ENTRIES: CarrierDisplayEntry[] = [
  {
    aliases: ["MAERSK", "MAERSK LINE", "MAEU", "MSK"],
    canonical: "Maersk",
    labels: { "zh-CN": "马士基", en: "Maersk", ru: "Maersk", de: "Maersk", fr: "Maersk", es: "Maersk" },
  },
  {
    aliases: ["MSC", "MEDITERRANEAN SHIPPING COMPANY", "MSCU"],
    canonical: "MSC",
    labels: { "zh-CN": "地中海航运", en: "MSC", ru: "MSC", de: "MSC", fr: "MSC", es: "MSC" },
  },
  {
    aliases: ["CMA CGM", "CMACGM", "CMDU", "CMA"],
    canonical: "CMA CGM",
    labels: { "zh-CN": "达飞轮船", en: "CMA CGM", ru: "CMA CGM", de: "CMA CGM", fr: "CMA CGM", es: "CMA CGM" },
  },
  {
    aliases: ["COSCO", "COSCO SHIPPING", "COSU"],
    canonical: "COSCO Shipping",
    labels: { "zh-CN": "中远海运", en: "COSCO Shipping", ru: "COSCO Shipping", de: "COSCO Shipping", fr: "COSCO Shipping", es: "COSCO Shipping" },
  },
  {
    aliases: ["ONE", "OCEAN NETWORK EXPRESS", "ONEY"],
    canonical: "ONE",
    labels: { "zh-CN": "海洋网联船务", en: "ONE", ru: "ONE", de: "ONE", fr: "ONE", es: "ONE" },
  },
  {
    aliases: ["EVERGREEN", "EVERGREEN LINE", "EMC", "EGLV"],
    canonical: "Evergreen",
    labels: { "zh-CN": "长荣海运", en: "Evergreen", ru: "Evergreen", de: "Evergreen", fr: "Evergreen", es: "Evergreen" },
  },
  {
    aliases: ["HMM", "HYUNDAI MERCHANT MARINE", "HDMU"],
    canonical: "HMM",
    labels: { "zh-CN": "韩新海运", en: "HMM", ru: "HMM", de: "HMM", fr: "HMM", es: "HMM" },
  },
  {
    aliases: ["HAPAG LLOYD", "HAPAG-LLOYD", "HLCU"],
    canonical: "Hapag-Lloyd",
    labels: { "zh-CN": "赫伯罗特", en: "Hapag-Lloyd", ru: "Hapag-Lloyd", de: "Hapag-Lloyd", fr: "Hapag-Lloyd", es: "Hapag-Lloyd" },
  },
  {
    aliases: ["OOCL", "ORIENT OVERSEAS CONTAINER LINE", "OOLU"],
    canonical: "OOCL",
    labels: { "zh-CN": "东方海外", en: "OOCL", ru: "OOCL", de: "OOCL", fr: "OOCL", es: "OOCL" },
  },
  {
    aliases: ["YANG MING", "YANG MING MARINE", "YMLU"],
    canonical: "Yang Ming",
    labels: { "zh-CN": "阳明海运", en: "Yang Ming", ru: "Yang Ming", de: "Yang Ming", fr: "Yang Ming", es: "Yang Ming" },
  },
  {
    aliases: ["ZIM", "ZIM LINE", "ZIMU"],
    canonical: "ZIM",
    labels: { "zh-CN": "以星航运", en: "ZIM", ru: "ZIM", de: "ZIM", fr: "ZIM", es: "ZIM" },
  },
];

const PORT_DISPLAY_ENTRIES: PortDisplayEntry[] = [
  { codes: ["CNSHA"], aliases: ["SHANGHAI", "上海"], labels: { "zh-CN": "上海", en: "Shanghai", ru: "Шанхай", de: "Shanghai", fr: "Shanghai", es: "Shanghái" } },
  { codes: ["DKAAR"], aliases: ["AARHUS", "ÅRHUS", "奥胡斯"], labels: { "zh-CN": "奥胡斯", en: "Aarhus", ru: "Орхус", de: "Aarhus", fr: "Aarhus", es: "Aarhus" } },
  { codes: ["CNNGB"], aliases: ["NINGBO", "宁波"], labels: { "zh-CN": "宁波", en: "Ningbo", ru: "Нинбо", de: "Ningbo", fr: "Ningbo", es: "Ningbo" } },
  { codes: ["CNTAO"], aliases: ["QINGDAO", "青岛"], labels: { "zh-CN": "青岛", en: "Qingdao", ru: "Циндао", de: "Qingdao", fr: "Qingdao", es: "Qingdao" } },
  { codes: ["CNXNG", "CNTXG"], aliases: ["TIANJIN", "XINGANG", "天津", "新港"], labels: { "zh-CN": "天津新港", en: "Tianjin Xingang", ru: "Тяньцзинь Синьган", de: "Tianjin Xingang", fr: "Tianjin Xingang", es: "Tianjin Xingang" } },
  { codes: ["CNSZX"], aliases: ["SHENZHEN", "深圳"], labels: { "zh-CN": "深圳", en: "Shenzhen", ru: "Шэньчжэнь", de: "Shenzhen", fr: "Shenzhen", es: "Shenzhen" } },
  { codes: ["CNYTN"], aliases: ["YANTIAN", "盐田"], labels: { "zh-CN": "盐田", en: "Yantian", ru: "Яньтянь", de: "Yantian", fr: "Yantian", es: "Yantian" } },
  { codes: ["CNSHK"], aliases: ["SHEKOU", "蛇口"], labels: { "zh-CN": "蛇口", en: "Shekou", ru: "Шэкоу", de: "Shekou", fr: "Shekou", es: "Shekou" } },
  { codes: ["CNXMN"], aliases: ["XIAMEN", "厦门"], labels: { "zh-CN": "厦门", en: "Xiamen", ru: "Сямэнь", de: "Xiamen", fr: "Xiamen", es: "Xiamen" } },
  { codes: ["CNDLC"], aliases: ["DALIAN", "大连"], labels: { "zh-CN": "大连", en: "Dalian", ru: "Далянь", de: "Dalian", fr: "Dalian", es: "Dalian" } },
  { codes: ["DEHAM"], aliases: ["HAMBURG", "汉堡"], labels: { "zh-CN": "汉堡", en: "Hamburg", ru: "Гамбург", de: "Hamburg", fr: "Hambourg", es: "Hamburgo" } },
  { codes: ["NLRTM"], aliases: ["ROTTERDAM", "鹿特丹"], labels: { "zh-CN": "鹿特丹", en: "Rotterdam", ru: "Роттердам", de: "Rotterdam", fr: "Rotterdam", es: "Róterdam" } },
  { codes: ["BEANR"], aliases: ["ANTWERP", "ANTWERPEN", "安特卫普"], labels: { "zh-CN": "安特卫普", en: "Antwerp", ru: "Антверпен", de: "Antwerpen", fr: "Anvers", es: "Amberes" } },
  { codes: ["ESVLC"], aliases: ["VALENCIA", "瓦伦西亚"], labels: { "zh-CN": "瓦伦西亚", en: "Valencia", ru: "Валенсия", de: "Valencia", fr: "Valence", es: "Valencia" } },
  { codes: ["ESBCN"], aliases: ["BARCELONA", "巴塞罗那"], labels: { "zh-CN": "巴塞罗那", en: "Barcelona", ru: "Барселона", de: "Barcelona", fr: "Barcelone", es: "Barcelona" } },
  { codes: ["USLAX"], aliases: ["LOS ANGELES", "洛杉矶"], labels: { "zh-CN": "洛杉矶", en: "Los Angeles", ru: "Лос-Анджелес", de: "Los Angeles", fr: "Los Angeles", es: "Los Ángeles" } },
  { codes: ["USLGB"], aliases: ["LONG BEACH", "长滩"], labels: { "zh-CN": "长滩", en: "Long Beach", ru: "Лонг-Бич", de: "Long Beach", fr: "Long Beach", es: "Long Beach" } },
  { codes: ["USNYC"], aliases: ["NEW YORK", "纽约"], labels: { "zh-CN": "纽约", en: "New York", ru: "Нью-Йорк", de: "New York", fr: "New York", es: "Nueva York" } },
  { codes: ["GBFXT"], aliases: ["FELIXSTOWE", "费利克斯托"], labels: { "zh-CN": "费利克斯托", en: "Felixstowe", ru: "Феликстоу", de: "Felixstowe", fr: "Felixstowe", es: "Felixstowe" } },
  { codes: ["PLGDN"], aliases: ["GDANSK", "GDAŃSK", "格但斯克"], labels: { "zh-CN": "格但斯克", en: "Gdansk", ru: "Гданьск", de: "Danzig", fr: "Gdansk", es: "Gdansk" } },
  { codes: ["RULED"], aliases: ["SAINT PETERSBURG", "ST PETERSBURG", "圣彼得堡"], labels: { "zh-CN": "圣彼得堡", en: "Saint Petersburg", ru: "Санкт-Петербург", de: "Sankt Petersburg", fr: "Saint-Pétersbourg", es: "San Petersburgo" } },
  { codes: ["RUVVO"], aliases: ["VLADIVOSTOK", "符拉迪沃斯托克", "海参崴"], labels: { "zh-CN": "符拉迪沃斯托克", en: "Vladivostok", ru: "Владивосток", de: "Wladiwostok", fr: "Vladivostok", es: "Vladivostok" } },
  { codes: ["DKCPH"], aliases: ["COPENHAGEN", "哥本哈根"], labels: { "zh-CN": "哥本哈根", en: "Copenhagen", ru: "Копенгаген", de: "Kopenhagen", fr: "Copenhague", es: "Copenhague" } },
];

const STATUS_DISPLAY_ENTRIES: StatusDisplayEntry[] = [
  { aliases: ["SAILING", "ONBOARD", "ON BOARD", "DEPARTED"], labels: { "zh-CN": "航行中", en: "Sailing", ru: "В рейсе", de: "Auf See", fr: "En mer", es: "Navegando" } },
  { aliases: ["ARRIVED", "DISCHARGED", "POD"], labels: { "zh-CN": "已到港", en: "Arrived", ru: "Прибыло в порт", de: "Angekommen", fr: "Arrivé", es: "Llegado" } },
  { aliases: ["DELIVERED", "COMPLETE", "COMPLETED", "CLOSED", "FINISHED"], labels: { "zh-CN": "已完成", en: "Delivered", ru: "Доставлено", de: "Abgeschlossen", fr: "Livré", es: "Entregado" } },
  { aliases: ["PENDING", "NEW", "LOCAL_PENDING", "NOT_SYNCED"], labels: { "zh-CN": "待更新", en: "Pending", ru: "Ожидает обновления", de: "Ausstehend", fr: "En attente", es: "Pendiente" } },
  { aliases: ["IN TRANSIT", "INTRANSIT", "TRANSIT", "INPROGRESS", "IN_PROGRESS", "LOADED"], labels: { "zh-CN": "运输途中", en: "In Transit", ru: "В пути", de: "Unterwegs", fr: "En transit", es: "En tránsito" } },
  { aliases: ["FAIL", "FAILED", "ERROR", "SYNC_FAILED"], labels: { "zh-CN": "同步失败", en: "Sync Failed", ru: "Ошибка синхронизации", de: "Synchronisierung fehlgeschlagen", fr: "Échec de synchronisation", es: "Error de sincronización" } },
  { aliases: ["UNKNOWN"], labels: { "zh-CN": "待更新", en: "Pending", ru: "Ожидает обновления", de: "Ausstehend", fr: "En attente", es: "Pendiente" } },
];

const TRACKING_METHOD_LABELS: Record<string, LocalizedLabels> = {
  MASTERBL: { "zh-CN": "主提单跟踪", en: "Master B/L Tracking", ru: "Отслеживание Master B/L", de: "Master-B/L-Verfolgung", fr: "Suivi Master B/L", es: "Seguimiento Master B/L" },
  HOUSEBL: { "zh-CN": "分提单跟踪", en: "House B/L Tracking", ru: "Отслеживание House B/L", de: "House-B/L-Verfolgung", fr: "Suivi House B/L", es: "Seguimiento House B/L" },
  CONTAINER: { "zh-CN": "集装箱跟踪", en: "Container Tracking", ru: "Отслеживание контейнера", de: "Containerverfolgung", fr: "Suivi conteneur", es: "Seguimiento de contenedor" },
};

function normalizedLookup(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "");
}

function originalText(value: unknown) {
  return String(value || "").trim();
}

function labelFor(labels: LocalizedLabels, locale: unknown, fallback: string) {
  const normalized = normalizeShipsgoDisplayLocale(locale);
  return labels[normalized] || labels[DEFAULT_LOCALE] || fallback;
}

function findCarrier(value: unknown, code: unknown = "") {
  const candidates = [value, code].map(normalizedLookup).filter(Boolean);
  return CARRIER_DISPLAY_ENTRIES.find((entry) => (
    entry.aliases.some((alias) => candidates.includes(normalizedLookup(alias)))
  ));
}

function findPort(name: unknown, code: unknown = "") {
  const normalizedName = normalizedLookup(name);
  const normalizedCode = normalizedLookup(code);
  return PORT_DISPLAY_ENTRIES.find((entry) => (
    entry.codes.some((item) => normalizedLookup(item) === normalizedCode)
    || entry.aliases.some((alias) => normalizedLookup(alias) === normalizedName)
  ));
}

function findStatus(value: unknown) {
  const normalized = normalizedLookup(value);
  return STATUS_DISPLAY_ENTRIES.find((entry) => (
    entry.aliases.some((alias) => {
      const aliasKey = normalizedLookup(alias);
      return normalized === aliasKey || normalized.includes(aliasKey);
    })
  ));
}

export function normalizeShipsgoDisplayLocale(value: unknown): ShipsgoDisplayLocale {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower === "cn" || lower === "chinese") return "zh-CN";
  if (lower === "ru" || lower === "ru-ru" || lower === "russian") return "ru";
  if (lower === "de" || lower === "de-de" || lower === "german") return "de";
  if (lower === "fr" || lower === "fr-fr" || lower === "french") return "fr";
  if (lower === "es" || lower === "es-es" || lower === "spanish") return "es";
  if (lower === "en" || lower === "en-us" || lower === "en-gb" || lower === "english") return "en";
  return SUPPORTED_LOCALES.has(text as ShipsgoDisplayLocale) ? text as ShipsgoDisplayLocale : DEFAULT_LOCALE;
}

export function formatShipsgoCarrierForLocale(value: unknown, code: unknown = "", locale: unknown = DEFAULT_LOCALE) {
  const raw = originalText(value) || originalText(code);
  if (!raw) return "";
  const carrier = findCarrier(raw, code);
  if (!carrier) return raw;
  const label = labelFor(carrier.labels, locale, carrier.canonical);
  if (normalizeShipsgoDisplayLocale(locale) === "zh-CN") return `${label}（${carrier.canonical}）`;
  return label || raw;
}

export function formatShipsgoPortForLocale(name: unknown, code: unknown = "", locale: unknown = DEFAULT_LOCALE) {
  const rawName = originalText(name);
  const rawCode = originalText(code);
  const raw = rawName || rawCode;
  if (!raw) return "";
  const port = findPort(rawName, rawCode);
  if (!port) return rawName || rawCode;
  const label = labelFor(port.labels, locale, rawName || rawCode);
  if (normalizeShipsgoDisplayLocale(locale) === "zh-CN") return `${label}（${rawCode || rawName}）`;
  return label || raw;
}

export function formatShipsgoStatusForLocale(value: unknown, locale: unknown = DEFAULT_LOCALE) {
  const raw = originalText(value);
  if (!raw) return "";
  const status = findStatus(raw);
  return status ? labelFor(status.labels, locale, raw) : raw;
}

export function formatShipsgoTrackingMethodForLocale(value: unknown, locale: unknown = DEFAULT_LOCALE) {
  const raw = originalText(value) || "Master B/L";
  const key = normalizedLookup(raw);
  const normalizedKey = key.includes("HOUSE") ? "HOUSEBL" : key.includes("CONTAINER") ? "CONTAINER" : "MASTERBL";
  return labelFor(TRACKING_METHOD_LABELS[normalizedKey], locale, raw);
}

