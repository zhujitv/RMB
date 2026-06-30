import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { ensureR2Configured, readR2Object, safeFileName, uploadToR2 } from "../r2";
import { codedError, isPlainRecord } from "./shared-base-utils";
import { assertRead, assertWrite } from "./shared-auth";
import { runNonCriticalTask } from "./shared-constants";
import { writeAudit } from "./shared-audit";

export const SYSTEM_BACKUP_RECORDS_SETTING_KEY = "system_backup_records";
export const SYSTEM_BACKUP_VERSION = "NEXTWOOD_BACKUP_V1";

const DEFAULT_RETENTION_COUNT = 20;
const BACKUP_SCOPE = "business-data";
const REDACTED = "[REDACTED]";
const SENSITIVE_BACKUP_KEY_PATTERN = /(password|passwordHash|token|secret|apiKey|accessKey|authorization|cookie|session|databaseUrl|DATABASE_URL|smtp|webhookSecret)/i;

type SettingsActor = Parameters<typeof assertRead>[0];
type AuditRequestLike = Parameters<typeof writeAudit>[0];

export type SystemBackupRecord = {
  id: string;
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  sizeLabel: string;
  createdAt: string;
  createdById?: string | null;
  createdByName?: string;
  status: "SUCCESS";
  scope: string;
  tables: string[];
  rowCounts: Record<string, number>;
};

type SystemBackupRecordStore = {
  retentionCount: number;
  records: SystemBackupRecord[];
};

type BackupTable = {
  key: string;
  label: string;
  load: () => Promise<unknown[]>;
};

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function sanitizeSettingValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeSettingValue(item));
  if (value && value.constructor?.name === "Decimal" && "toString" in value) return String(value);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_BACKUP_KEY_PATTERN.test(key) ? REDACTED : sanitizeSettingValue(item),
    ]),
  );
}

function parseBackupRecordStore(value: unknown): SystemBackupRecordStore {
  const input = isPlainRecord(value) ? value : {};
  const retentionCount = Number(input.retentionCount || DEFAULT_RETENTION_COUNT);
  const records = Array.isArray(input.records)
    ? input.records.filter(isPlainRecord).map((record) => ({
      id: String(record.id || ""),
      fileName: String(record.fileName || ""),
      storageKey: String(record.storageKey || ""),
      sizeBytes: Number(record.sizeBytes || 0),
      sizeLabel: String(record.sizeLabel || formatBytes(Number(record.sizeBytes || 0))),
      createdAt: String(record.createdAt || ""),
      createdById: typeof record.createdById === "string" ? record.createdById : null,
      createdByName: String(record.createdByName || ""),
      status: "SUCCESS" as const,
      scope: String(record.scope || BACKUP_SCOPE),
      tables: Array.isArray(record.tables) ? record.tables.map((item) => String(item)) : [],
      rowCounts: isPlainRecord(record.rowCounts)
        ? Object.fromEntries(Object.entries(record.rowCounts).map(([key, count]) => [key, Number(count || 0)]))
        : {},
    })).filter((record) => record.id && record.fileName && record.storageKey && record.createdAt)
    : [];
  return {
    retentionCount: Number.isFinite(retentionCount) && retentionCount > 0 ? Math.min(100, Math.floor(retentionCount)) : DEFAULT_RETENTION_COUNT,
    records,
  };
}

async function readBackupRecordStore() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: SYSTEM_BACKUP_RECORDS_SETTING_KEY } });
  return parseBackupRecordStore(setting?.value || {});
}

async function writeBackupRecordStore(store: SystemBackupRecordStore) {
  const value = {
    retentionCount: store.retentionCount,
    records: store.records.slice(0, store.retentionCount),
  };
  await prisma.systemSetting.upsert({
    where: { key: SYSTEM_BACKUP_RECORDS_SETTING_KEY },
    update: { value: value as Prisma.InputJsonValue },
    create: { key: SYSTEM_BACKUP_RECORDS_SETTING_KEY, value: value as Prisma.InputJsonValue },
  });
  return parseBackupRecordStore(value);
}

async function storageConfigured() {
  try {
    ensureR2Configured();
    return true;
  } catch {
    return false;
  }
}

async function sanitizedSystemSettings() {
  const settings = await prisma.systemSetting.findMany({
    where: { key: { not: SYSTEM_BACKUP_RECORDS_SETTING_KEY } },
    orderBy: { key: "asc" },
  });
  return settings.map((setting) => ({
    ...setting,
    value: sanitizeSettingValue(setting.value),
  }));
}

const BACKUP_TABLES: BackupTable[] = [
  {
    key: "users",
    label: "用户",
    load: () => prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        englishName: true,
        department: true,
        avatarInitials: true,
        avatarUrl: true,
        defaultLanguage: true,
        defaultHome: true,
        pageSize: true,
        loginAlertEnabled: true,
        customPermissions: true,
        supplierId: true,
        mustChangePassword: true,
        passwordPolicyPassed: true,
        passwordChangedAt: true,
        emailVerified: true,
        emailVerifiedAt: true,
        approvalStatus: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  },
  { key: "customers", label: "客户", load: () => prisma.customer.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "suppliers", label: "供应商", load: () => prisma.supplier.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "receivableOrders", label: "应收订单", load: () => prisma.receivableOrder.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "payments", label: "收款", load: () => prisma.payment.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "orderCosts", label: "成本", load: () => prisma.orderCost.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "logisticsBills", label: "物流费用账单", load: () => prisma.logisticsBill.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "logisticsExpenses", label: "物流费用明细", load: () => prisma.logisticsExpense.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "domesticLogisticsInfos", label: "物流信息", load: () => prisma.domesticLogisticsInfo.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "domesticLogisticsTransportItems", label: "集装箱运输明细", load: () => prisma.domesticLogisticsTransportItem.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "domesticLogisticsDocuments", label: "物流报关资料", load: () => prisma.domesticLogisticsDocument.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "orderDocuments", label: "订单附件", load: () => prisma.orderDocument.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "supplierDocumentRequests", label: "资料回传任务", load: () => prisma.supplierDocumentRequest.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "shippingDocumentNotifications", label: "清关资料通知", load: () => prisma.shippingDocumentNotification.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "orderLogisticsSuppliers", label: "订单物流供应商", load: () => prisma.orderLogisticsSupplier.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "shipsgoTrackings", label: "大掌櫃跟踪", load: () => prisma.shipsgoTracking.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "shipsgoTrackingContainers", label: "大掌櫃柜号关联", load: () => prisma.shipsgoTrackingContainer.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "exchangeRates", label: "汇率", load: () => prisma.exchangeRate.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "commissionSettlements", label: "提成结算", load: () => prisma.commissionSettlement.findMany({ orderBy: { createdAt: "asc" } }) },
  { key: "systemSettings", label: "系统配置", load: sanitizedSystemSettings },
  { key: "auditLogs", label: "审计日志", load: () => prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } }) },
];

function backupJsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && value.constructor?.name === "Decimal" && "toString" in value) {
    return String(value);
  }
  return value;
}

async function collectBackupData() {
  const entries = await Promise.all(
    BACKUP_TABLES.map(async (table) => {
      const rows = await table.load();
      return [table.key, rows] as const;
    }),
  );
  const data = Object.fromEntries(entries);
  const rowCounts = Object.fromEntries(entries.map(([key, rows]) => [key, rows.length]));
  return { data, rowCounts };
}

async function actorName(actor: SettingsActor) {
  if (!actor?.id) return "";
  const user = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
  return user?.name || user?.email || "";
}

function publicBackupRecord(record: SystemBackupRecord) {
  const { storageKey: _storageKey, ...safeRecord } = record;
  return safeRecord;
}

export async function readSystemBackupSettings(actor: SettingsActor) {
  assertRead(actor, "settings");
  const store = await readBackupRecordStore();
  return {
    retentionCount: store.retentionCount,
    storageConfigured: await storageConfigured(),
    lastBackupAt: store.records[0]?.createdAt || "",
    backups: store.records.map(publicBackupRecord),
    scope: BACKUP_SCOPE,
    tables: BACKUP_TABLES.map((table) => ({ key: table.key, label: table.label })),
    excluded: ["passwordHash", "user_sessions", "email_verification_tokens", "login_attempts", "API Key", "Webhook Secret"],
  };
}

export async function createSystemBackup(request: AuditRequestLike, actor: SettingsActor) {
  assertWrite(actor, "settings");
  ensureR2Configured();
  const now = new Date();
  const id = randomUUID();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const fileName = safeFileName(`nextwood-system-backup-${stamp}.json`);
  const storageKey = `system-backups/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}-${fileName}`;
  const { data, rowCounts } = await collectBackupData();
  const payload = {
    version: SYSTEM_BACKUP_VERSION,
    createdAt: now.toISOString(),
    createdBy: {
      id: actor?.id || null,
      role: actor?.role || "",
    },
    scope: BACKUP_SCOPE,
    tables: BACKUP_TABLES.map((table) => ({ key: table.key, label: table.label, rows: rowCounts[table.key] || 0 })),
    excluded: [
      "用户密码哈希",
      "登录会话",
      "邮箱验证码",
      "登录尝试明细",
      "第三方 API Key / Webhook Secret（已脱敏）",
    ],
    data,
  };
  const json = `${JSON.stringify(payload, backupJsonReplacer, 2)}\n`;
  const body = Buffer.from(json, "utf8");
  await uploadToR2({ key: storageKey, body, contentType: "application/json; charset=utf-8" });
  const store = await readBackupRecordStore();
  const backup: SystemBackupRecord = {
    id,
    fileName,
    storageKey,
    sizeBytes: body.byteLength,
    sizeLabel: formatBytes(body.byteLength),
    createdAt: now.toISOString(),
    createdById: actor?.id || null,
    createdByName: await actorName(actor),
    status: "SUCCESS",
    scope: BACKUP_SCOPE,
    tables: BACKUP_TABLES.map((table) => table.key),
    rowCounts,
  };
  const nextStore = await writeBackupRecordStore({
    retentionCount: store.retentionCount,
    records: [backup, ...store.records.filter((record) => record.id !== backup.id)],
  });
  await runNonCriticalTask("系统备份操作日志写入", () => (
    writeAudit(request, actor, "生成系统备份", "system_settings", backup.id, null, {
      id: backup.id,
      fileName: backup.fileName,
      sizeBytes: backup.sizeBytes,
      tables: backup.tables,
      rowCounts: backup.rowCounts,
    })
  ));
  return {
    backup,
    settings: {
      retentionCount: nextStore.retentionCount,
      storageConfigured: true,
      lastBackupAt: backup.createdAt,
      backups: nextStore.records.map(publicBackupRecord),
      scope: BACKUP_SCOPE,
      tables: BACKUP_TABLES.map((table) => ({ key: table.key, label: table.label })),
    },
  };
}

export async function readSystemBackupFile(actor: SettingsActor, backupId: string) {
  assertRead(actor, "settings");
  const store = await readBackupRecordStore();
  const backup = store.records.find((record) => record.id === backupId);
  if (!backup) throw codedError("系统备份不存在或已被清理", 404, "SYSTEM_BACKUP_NOT_FOUND");
  const body = await readR2Object(backup.storageKey);
  return { backup, body };
}
