const FREIGHTOWER_LOCAL_DATE_PATTERN = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

function freightowerOffsetMinutes(value: unknown, fallbackHours = 8) {
  const text = String(value ?? "").trim().toUpperCase().replace(/^UTC/, "");
  const colonMatch = /^([+-]?)(\d{1,2}):(\d{2})$/.exec(text);
  if (colonMatch) {
    const sign = colonMatch[1] === "-" ? -1 : 1;
    return sign * (Number(colonMatch[2]) * 60 + Number(colonMatch[3]));
  }
  const hours = text ? Number(text) : fallbackHours;
  return Number.isFinite(hours) && Math.abs(hours) <= 14 ? Math.round(hours * 60) : fallbackHours * 60;
}

export function parseFreightowerDate(value: unknown, portTimeZone?: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const explicitDate = new Date(text);
    return Number.isNaN(explicitDate.getTime()) ? null : explicitDate;
  }
  const match = FREIGHTOWER_LOCAL_DATE_PATTERN.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const millisecond = Number((match[7] || "").padEnd(3, "0") || 0);
  const localUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const validation = new Date(localUtc);
  if (
    validation.getUTCFullYear() !== year
    || validation.getUTCMonth() !== month - 1
    || validation.getUTCDate() !== day
    || validation.getUTCHours() !== hour
    || validation.getUTCMinutes() !== minute
    || validation.getUTCSeconds() !== second
  ) return null;
  return new Date(localUtc - freightowerOffsetMinutes(portTimeZone) * 60_000);
}
