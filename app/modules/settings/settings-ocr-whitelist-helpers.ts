import type { CustomsProductWhitelistEntry, OcrIntegrationSettings } from "./types";

export function customsProductWhitelistFromSettings(settings: OcrIntegrationSettings | null): CustomsProductWhitelistEntry[] {
  const rows = Array.isArray(settings?.customsProductWhitelist) ? settings.customsProductWhitelist : [];
  return rows
    .map((raw) => {
      const item = raw as Partial<CustomsProductWhitelistEntry>;
      return {
        id: String(item.id || ""),
        standardName: String(item.standardName || ""),
        aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
        hsCodes: Array.isArray(item.hsCodes) ? item.hsCodes.map(String) : [],
        enabled: item.enabled !== false,
      };
    })
    .filter((item) => item.standardName.trim());
}
