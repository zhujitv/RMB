import type { Prisma } from "../generated/prisma/client.js";
import type { normalizeExchangeRateSettings } from "./shared-exchange-settings";
import type { writeAudit } from "./shared-audit";

export type ExchangeRateSettingsInput = Record<string, unknown>;
export type ExchangeRateRowInput = {
  currency: string;
  rateToCny: number;
  rateDate: string;
  source: string;
  rateType: string;
};
export type RefreshExchangeRateOptions = {
  source?: unknown;
  rateType?: unknown;
};
export type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ExchangeSnapshotOptions = {
  currency?: unknown;
  defaultDate?: unknown;
  allowHistoricalSource?: boolean;
};
export type ExchangeRateSettings = ReturnType<typeof normalizeExchangeRateSettings>;
export type SerializedExchangeRate = {
  id: string;
  currency: string;
  rateToCny: number;
  exchangeRate: number;
  rate: number;
  rateDate: string;
  source: string;
  rateType: string;
  isFallbackDate: boolean;
  message: string;
  createdAt: Date;
  updatedAt: Date;
};
export type ExchangeRateQuote = SerializedExchangeRate & {
  settings: ExchangeRateSettings;
};
export type ExchangeRateSnapshot = {
  currency: string;
  exchangeRate: number;
  exchangeRateDate: Date | null;
  exchangeRateSource: string;
  exchangeRateType: string;
};

