import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";

export type IpGeolocationResult = {
  ipAddress: string;
  country: string;
  region: string;
  city: string;
  isp: string;
  source: string;
};

type IpRangeRule = {
  cidr?: string;
  start?: string;
  end?: string;
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
  source?: string;
};

const LOCAL_DB_PATH = resolve(process.cwd(), "data/ip-geolocation-ranges.json");

let cachedRules: IpRangeRule[] | null = null;

function loadRules() {
  if (cachedRules) return cachedRules;
  try {
    if (!existsSync(LOCAL_DB_PATH)) {
      cachedRules = [];
      return cachedRules;
    }
    const parsed = JSON.parse(readFileSync(LOCAL_DB_PATH, "utf8"));
    cachedRules = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("ip geolocation local db load failed", error);
    cachedRules = [];
  }
  return cachedRules;
}

function normalizeIp(input: unknown) {
  let ip = String(input || "").trim();
  if (!ip) return "";
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  if (ip.startsWith("::ffff:")) ip = ip.slice("::ffff:".length);
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  return ip;
}

function ipv4ToNumber(ip: string) {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] * 256 ** 3) + (parts[1] * 256 ** 2) + (parts[2] * 256) + parts[3]) >>> 0;
}

function cidrToRange(cidr: string) {
  const [baseIp, prefixText] = cidr.split("/");
  const base = ipv4ToNumber(baseIp);
  const prefix = Number(prefixText);
  if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = (base & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  return { start, end: (start + size - 1) >>> 0 };
}

function ruleMatchesIp(rule: IpRangeRule, ipNumber: number) {
  if (rule.cidr) {
    const range = cidrToRange(rule.cidr);
    return Boolean(range && ipNumber >= range.start && ipNumber <= range.end);
  }
  const start = rule.start ? ipv4ToNumber(rule.start) : null;
  const end = rule.end ? ipv4ToNumber(rule.end) : null;
  return start !== null && end !== null && ipNumber >= start && ipNumber <= end;
}

function resultFromRule(ipAddress: string, rule: IpRangeRule): IpGeolocationResult {
  return {
    ipAddress,
    country: String(rule.country || ""),
    region: String(rule.region || ""),
    city: String(rule.city || ""),
    isp: String(rule.isp || ""),
    source: String(rule.source || "local-ip-db"),
  };
}

function ipv6LocalResult(ipAddress: string): IpGeolocationResult | null {
  const normalized = ipAddress.toLowerCase();
  if (normalized === "::1") {
    return {
      ipAddress,
      country: "本地",
      region: "本地开发环境",
      city: "",
      isp: "",
      source: "local-ip-db",
    };
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) {
    return {
      ipAddress,
      country: "内网",
      region: normalized.startsWith("fe80:") ? "链路本地地址" : "内网地址",
      city: "",
      isp: "",
      source: "local-ip-db",
    };
  }
  return null;
}

export function resolveIpGeolocation(input: unknown): IpGeolocationResult {
  const ipAddress = normalizeIp(input);
  if (!ipAddress) {
    return {
      ipAddress: "",
      country: "未知",
      region: "未记录 IP",
      city: "",
      isp: "",
      source: "local-ip-db-empty",
    };
  }

  const ipVersion = isIP(ipAddress);
  if (ipVersion === 6) {
    return ipv6LocalResult(ipAddress) || {
      ipAddress,
      country: "未知",
      region: "未知地区",
      city: "",
      isp: "",
      source: "local-ip-db-unmatched",
    };
  }

  const ipNumber = ipv4ToNumber(ipAddress);
  if (ipNumber === null) {
    return {
      ipAddress,
      country: "未知",
      region: "IP 格式异常",
      city: "",
      isp: "",
      source: "local-ip-db-invalid",
    };
  }

  const matchedRule = loadRules().find((rule) => ruleMatchesIp(rule, ipNumber));
  if (matchedRule) return resultFromRule(ipAddress, matchedRule);

  return {
    ipAddress,
    country: "未知",
    region: "未知地区",
    city: "",
    isp: "",
    source: "local-ip-db-unmatched",
  };
}

export function formatIpGeolocation(result: Partial<IpGeolocationResult> | null | undefined) {
  const country = String(result?.country || "").trim();
  const region = String(result?.region || "").trim();
  if (["本地", "内网", "保留地址", "未知"].includes(country) && region) {
    const isp = String(result?.isp || "").trim();
    return isp ? `${region} / ${isp}` : region;
  }
  const values = [country, region, result?.city]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
  const location = values.length ? values.join(" · ") : "未知地区";
  const isp = String(result?.isp || "").trim();
  return isp ? `${location} / ${isp}` : location;
}
