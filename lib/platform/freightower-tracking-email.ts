import { NOTIFICATION_TYPES, type JsonRecord } from "./notification-definition-types";

type TimelineRow = {
  time?: unknown;
  location?: unknown;
  description?: unknown;
  vesselName?: unknown;
  voyage?: unknown;
  eventCode?: unknown;
  source?: unknown;
};

const CUSTOMER_EVENT_LABELS: Record<string, string> = {
  ARRI: "Vessel arrived",
  DEPA: "Vessel departed",
  LOAD: "Loaded on board",
  DISC: "Container discharged",
  GTIN: "Gate in",
  GTOT: "Gate out",
  STUF: "Container stuffed",
  STRP: "Container stripped",
  PICK: "Empty container picked up",
  DROP: "Empty container returned",
  PRLD: "Pre-loading confirmed",
  TMPS: "Terminal release",
  RELS: "Terminal release",
  DUMP: "Container rollover alert",
  HOLD: "Shipment on hold",
  BLA: "Declaration accepted",
  BLR: "Bill of lading released",
  ASB: "Declaration rejected",
  AAD: "Declaration accepted",
  ASA: "Cargo arrived at customs",
  EDC: "Declaration received",
  CDC: "Customs review completed",
  CPI: "Customs inspection",
  PAS: "Customs released",
  DEL: "Declaration cancelled",
  CLR: "Customs clearance completed",
  EDEP: "Departure confirmed",
  MFA: "Manifest accepted",
  MFB: "Manifest filed",
  MFR: "Bill of lading released",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function text(value: unknown, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "-" ? normalized : fallback;
}

function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function timelineRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is TimelineRow => Boolean(item && typeof item === "object" && !Array.isArray(item)));
}

export function freightowerCustomerEventText(row: TimelineRow | null | undefined) {
  if (!row) return "Shipment status updated";
  const code = String(row.eventCode || "").trim().toUpperCase();
  return CUSTOMER_EVENT_LABELS[code] || "Shipment status updated";
}

export function freightowerCustomerStatusText(value: unknown, warning: boolean) {
  if (warning) return "Attention required";
  const normalized = String(value || "").toUpperCase();
  if (/DELIVER|COMPLET|已送达|已完成/.test(normalized)) return "Delivered";
  if (/ARRIV|到港|抵达/.test(normalized)) return "Arrived at destination";
  if (/DEPART|离港|在途|TRANSIT/.test(normalized)) return "In transit";
  if (/BOOK|订舱|预配|提空箱/.test(normalized)) return "Shipment preparing";
  return "Shipment update";
}

function displayTimelineTime(value: unknown, locale: "zh" | "en") {
  const raw = String(value || "").trim();
  if (!raw) return locale === "zh" ? "待飞驼更新" : "Pending update";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function progressPercent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(4, Math.min(96, Math.round(number))) : 58;
}

function summaryCard(label: string, value: unknown, subline = "") {
  return `<td style="width:33.33%;padding:0 5px;vertical-align:top">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #cfe2f1;border-radius:8px;background:#ffffff">
      <tr><td style="padding:18px 14px;text-align:center">
        <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#758b9c">${escapeHtml(label)}</div>
        <div style="padding-top:8px;font-size:18px;line-height:1.35;font-weight:700;color:#294d63">${escapeHtml(value)}</div>
        ${subline ? `<div style="padding-top:7px;font-size:13px;line-height:1.45;color:#607b8c">${escapeHtml(subline)}</div>` : ""}
      </td></tr>
    </table>
  </td>`;
}

function routeProgress(origin: string, destination: string, progress: number, locale: "zh" | "en") {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px">
    <tr><td colspan="3" style="padding:0 8px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="width:${progress}%;height:7px;background:#10a8e5;border-radius:8px 0 0 8px"></td>
        <td style="width:38px;text-align:center;font-size:25px;line-height:25px;color:#e56f2e">▣</td>
        <td style="height:7px;border-top:4px dashed #10a8e5"></td>
        <td style="width:14px;height:14px;background:#23a455;border-radius:50%"></td>
      </tr></table>
    </td></tr>
    <tr>
      <td style="width:48%;vertical-align:top">
        <div style="font-size:11px;color:#98a5ad;text-transform:uppercase">${locale === "zh" ? "起运港" : "Origin port"}</div>
        <div style="padding-top:4px;font-size:21px;color:#365f76">${escapeHtml(origin)}</div>
      </td>
      <td style="width:4%"></td>
      <td style="width:48%;text-align:right;vertical-align:top">
        <div style="font-size:11px;color:#98a5ad;text-transform:uppercase">${locale === "zh" ? "目的港" : "Destination port"}</div>
        <div style="padding-top:4px;font-size:21px;color:#365f76">${escapeHtml(destination)}</div>
      </td>
    </tr>
  </table>`;
}

function timelineTable(rows: TimelineRow[], locale: "zh" | "en") {
  const displayed = [...rows].slice(-8).reverse();
  if (!displayed.length) {
    return `<div style="padding:24px;text-align:center;color:#7a8f9d;background:#f5f8fa;border-radius:8px">${locale === "zh" ? "飞驼暂未返回运输节点" : "No tracking events are available yet"}</div>`;
  }
  const headers = locale === "zh"
    ? ["地点", "运输节点", "时间", "船名 / 航次"]
    : ["Location", "Movement", "Date", "Vessel / Voyage"];
  const body = displayed.map((row, index) => {
    const description = locale === "zh" ? text(row.description, "运输状态更新") : freightowerCustomerEventText(row);
    const vesselVoyage = [text(row.vesselName, ""), text(row.voyage, "")].filter(Boolean).join(" / ") || "-";
    return `<tr style="background:${index % 2 ? "#f5f7f8" : "#ffffff"}">
      <td style="padding:13px 12px;border:1px solid #e0e6ea;color:#385a6e">${escapeHtml(text(row.location))}</td>
      <td style="padding:13px 12px;border:1px solid #e0e6ea;color:#385a6e">${escapeHtml(description)}</td>
      <td style="padding:13px 12px;border:1px solid #e0e6ea;color:#385a6e;white-space:nowrap">${escapeHtml(displayTimelineTime(row.time, locale))}</td>
      <td style="padding:13px 12px;border:1px solid #e0e6ea;color:#385a6e">${escapeHtml(vesselVoyage)}</td>
    </tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
    <thead><tr>${headers.map((header) => `<th style="padding:13px 12px;background:#08a9e6;border:1px solid #ffffff;text-align:left;color:#ffffff;font-size:13px">${header}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function freightowerTrackingEmailHtml(type: unknown, variables: JsonRecord = {}) {
  const locale: "zh" | "en" = type === NOTIFICATION_TYPES.FREIGHTOWER_TRACKING_CUSTOMER_UPDATE ? "en" : "zh";
  const warning = variables.warning === true || String(variables.warning || "").toLowerCase() === "true";
  const origin = text(variables.origin, locale === "zh" ? "待更新" : "Pending");
  const destination = text(variables.destination, locale === "zh" ? "待更新" : "Pending");
  const eventText = locale === "zh" ? text(variables.eventText, "运输状态更新") : text(variables.eventTextEn, "Shipment status updated");
  const status = locale === "zh"
    ? text(variables.statusText, "运输状态更新")
    : text(variables.statusTextEn, freightowerCustomerStatusText(variables.statusText, warning));
  const alertText = locale === "zh"
    ? `${eventText}；节点时间：${text(variables.eventTime, "待飞驼更新")}`
    : `${eventText}. Event time: ${text(variables.eventTimeEn || variables.eventTime, "Pending provider update")}`;
  const trackingUrl = safeUrl(variables.trackingUrl);
  const rows = timelineRows(variables.timeline);
  const progress = progressPercent(variables.progressPercent);
  const containerCount = Number(variables.containerCount || 0);
  const refLabel = locale === "zh" ? "订单号" : "REF NO.";
  const containerLabel = locale === "zh" ? `箱号${containerCount > 1 ? `（${containerCount}）` : ""}` : `Container No${containerCount > 1 ? `s (${containerCount})` : "."}`;
  const updateDate = locale === "zh" ? variables.updateDate : variables.updateDateEn || variables.updateDate;
  const eta = locale === "zh" ? variables.eta : variables.etaEn || variables.eta;
  const firstEta = locale === "zh" ? variables.firstEta : variables.firstEtaEn || variables.firstEta;
  const remainingText = locale === "zh" ? variables.remainingText : variables.remainingTextEn || variables.remainingText;
  const transitText = locale === "zh" ? variables.transitText : variables.transitTextEn || variables.transitText;
  const footer = locale === "zh"
    ? "以上物流信息来自第三方数据服务，请结合船公司信息确认。"
    : "Tracking information is provided by a third-party data service. Please confirm critical dates with the carrier.";
  return `<!doctype html>
<html lang="${locale === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef3f6;font-family:Arial,'Microsoft YaHei',sans-serif;color:#365f76">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(alertText)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f6"><tr><td align="center" style="padding:24px 10px">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:12px;box-shadow:0 5px 22px rgba(42,76,98,.08)">
      <tr><td style="padding:32px 34px 22px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:28px;font-weight:800;letter-spacing:.04em;color:#df742b">NEXTWOOD<div style="width:132px;margin-top:5px;border-top:4px solid #df742b"></div></td>
          <td align="right" style="font-size:12px;line-height:1.7;color:#758b9c">${escapeHtml(text(updateDate))}<br><strong>${refLabel}：</strong>${escapeHtml(text(variables.orderNo))}<br><strong>${containerLabel}：</strong>${escapeHtml(text(variables.containerNo))}</td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px -5px 0;width:calc(100% + 10px)"><tr>
          ${summaryCard(locale === "zh" ? "当前状态" : "Current status", status, `${locale === "zh" ? "承运人" : "Carrier"}: ${text(variables.carrier)}`)}
          ${summaryCard(locale === "zh" ? "预计到港" : "Estimated arrival", eta, `${locale === "zh" ? "原预计到港" : "Previous ETA"}: ${text(firstEta)}`)}
          ${summaryCard(locale === "zh" ? "剩余时间" : "Time to destination", remainingText, `${locale === "zh" ? "预计总运输" : "Total transit"}: ${text(transitText)}`)}
        </tr></table>
        ${routeProgress(origin, destination, progress, locale)}
        <div style="margin:26px 0 24px;padding:14px 16px;border-left:5px solid ${warning ? "#f04438" : "#10a8e5"};border-right:5px solid ${warning ? "#f04438" : "#10a8e5"};background:${warning ? "#fff0ef" : "#edf8fd"};font-size:14px;line-height:1.6;color:#365f76">
          <strong>${warning ? (locale === "zh" ? "需要关注" : "Attention") : (locale === "zh" ? "最新变化" : "Latest update")}：</strong>${escapeHtml(alertText)}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px"><tr>
          <td style="padding-right:10px"><div style="font-size:11px;color:#8ba0ad">${locale === "zh" ? "提单号" : "MBL / Booking No."}</div><div style="margin-top:7px;padding:12px;border:1px solid #b8d8ea;text-align:center;font-weight:700">${escapeHtml(text(variables.blNo))}</div></td>
          <td style="padding:0 5px"><div style="font-size:11px;color:#8ba0ad">${containerLabel}</div><div style="margin-top:7px;padding:12px;border:1px solid #b8d8ea;text-align:center;font-weight:700">${escapeHtml(text(variables.containerNo))}</div></td>
          <td style="padding-left:10px"><div style="font-size:11px;color:#8ba0ad">${locale === "zh" ? "船名 / 航次" : "Vessel / Voyage"}</div><div style="margin-top:7px;padding:12px;border:1px solid #b8d8ea;text-align:center;font-weight:700">${escapeHtml(text(variables.vesselVoyage))}</div></td>
        </tr></table>
        ${timelineTable(rows, locale)}
        ${trackingUrl ? `<div style="padding-top:26px;text-align:center"><a href="${escapeHtml(trackingUrl)}" style="display:inline-block;padding:13px 30px;border-radius:6px;background:#08a9e6;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">${locale === "zh" ? "查看实时物流位置" : "View live tracking"}</a></div>` : ""}
        <div style="padding-top:28px;font-size:12px;line-height:1.7;color:#7f919c">${footer}<br><br>${locale === "zh" ? "物流跟踪团队" : "Tracking Team"}<br><strong>NEXTWOOD</strong></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
