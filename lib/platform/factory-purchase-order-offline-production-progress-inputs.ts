import { codedError, isPlainRecord } from "./shared-base-errors";
import {
  normalizeSupplierProductionProgressInput,
  type ProductionProgressTarget,
} from "./factory-purchase-order-production-progress-inputs";

const OFFLINE_PROGRESS_CHANNELS = ["WECHAT", "PHONE", "EMAIL", "PAPER", "OTHER"] as const;
type OfflineProgressChannel = (typeof OFFLINE_PROGRESS_CHANNELS)[number];

function normalizeOfflineProgressChannel(value: unknown): OfflineProgressChannel {
  const channel = String(value || "").trim().toUpperCase();
  if (!OFFLINE_PROGRESS_CHANNELS.includes(channel as OfflineProgressChannel)) {
    throw codedError(
      "请选择有效的线下确认渠道",
      400,
      "FACTORY_CONFIRMATION_CHANNEL_INVALID",
    );
  }
  return channel as OfflineProgressChannel;
}

function normalizeSupplierContact(value: unknown) {
  const contact = typeof value === "string" ? value.trim() : "";
  if (!contact || contact.length > 100) {
    throw codedError(
      "请填写供应商实际回复人，且不能超过 100 个字符",
      400,
      "FACTORY_CONFIRMATION_CONTACT_INVALID",
    );
  }
  return contact;
}

function normalizeSupplierReportedAt(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw codedError(
      "供应商实际进度反馈时间格式无效，请重新选择",
      400,
      "FACTORY_PRODUCTION_PROGRESS_REPORTED_AT_INVALID",
    );
  }
  const reportedAt = new Date(text);
  if (Number.isNaN(reportedAt.getTime())) {
    throw codedError(
      "供应商实际进度反馈时间格式无效，请重新选择",
      400,
      "FACTORY_PRODUCTION_PROGRESS_REPORTED_AT_INVALID",
    );
  }
  return reportedAt;
}

export function normalizeOfflineProductionProgressInput(
  input: unknown,
  targets: ProductionProgressTarget[],
) {
  if (!isPlainRecord(input)) {
    throw codedError(
      "线下生产进度内容格式错误",
      400,
      "FACTORY_OFFLINE_PRODUCTION_PROGRESS_INVALID",
    );
  }
  const progress = normalizeSupplierProductionProgressInput(input, targets);
  return {
    ...progress,
    attribution: {
      source: "INTERNAL_OFFLINE" as const,
      channel: normalizeOfflineProgressChannel(input.channel),
      supplierContact: normalizeSupplierContact(input.supplierContact),
      supplierReportedAt: normalizeSupplierReportedAt(input.supplierReportedAt),
    },
  };
}
