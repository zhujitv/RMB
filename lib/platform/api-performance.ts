import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { assertRead } from "./shared-access";
import { nonEmpty } from "./shared-base-utils";
import { runNonCriticalTask } from "./shared-constants";
import { pageParams, pageResult } from "./shared-permission-data";

type QueryLike = {
  get(name: string): string | null;
};

type ApiPerformanceActor = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
} | null | undefined;

type ApiPerformanceInput = {
  source?: unknown;
  method?: unknown;
  path?: unknown;
  statusCode?: unknown;
  durationMs?: unknown;
  userId?: unknown;
  role?: unknown;
};

const API_PERFORMANCE_PATH_LIMIT = 240;
const API_PERFORMANCE_MAX_SCAN_ROWS = 5000;
const API_PERFORMANCE_RETENTION_DAYS = 14;
const API_PERFORMANCE_DEFAULT_WINDOW_HOURS = 24;
const API_PERFORMANCE_MAX_WINDOW_HOURS = 168;
const API_PERFORMANCE_SOURCE_VALUES = new Set(["server", "client"]);

function normalizeApiPerformancePath(pathInput: unknown) {
  const raw = String(pathInput || "").trim();
  if (!raw) return "";
  let path = raw;
  try {
    path = new URL(raw, "http://local").pathname;
  } catch {
    path = raw.split("?")[0] || raw;
  }
  if (!path.startsWith("/api/")) return "";
  if (path === "/api/settings/api-performance") return "";
  return path.slice(0, API_PERFORMANCE_PATH_LIMIT);
}

function normalizeApiPerformanceSource(sourceInput: unknown) {
  const source = String(sourceInput || "server").trim().toLowerCase();
  return API_PERFORMANCE_SOURCE_VALUES.has(source) ? source : "server";
}

function normalizeApiPerformanceMethod(methodInput: unknown) {
  return String(methodInput || "GET").trim().toUpperCase().slice(0, 12) || "GET";
}

function normalizeStatusCode(statusInput: unknown) {
  const value = Number(statusInput || 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function normalizeDurationMs(durationInput: unknown) {
  const value = Number(durationInput || 0);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function maybePruneApiPerformanceLogs() {
  if (Math.random() > 0.01) return;
  const cutoff = new Date(Date.now() - API_PERFORMANCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  void runNonCriticalTask("API 性能日志清理", () => prisma.apiPerformanceLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  }));
}

export function recordApiPerformanceLog(input: ApiPerformanceInput) {
  const path = normalizeApiPerformancePath(input.path);
  const durationMs = normalizeDurationMs(input.durationMs);
  if (!path || durationMs == null) return;

  const source = normalizeApiPerformanceSource(input.source);
  const method = normalizeApiPerformanceMethod(input.method);
  const statusCode = normalizeStatusCode(input.statusCode);
  const userId = nonEmpty(input.userId);
  const role = nonEmpty(input.role);

  void runNonCriticalTask("API 性能日志写入", () => prisma.apiPerformanceLog.create({
    data: {
      source,
      method,
      path,
      statusCode,
      durationMs,
      userId: userId || null,
      role: role || null,
    },
  }));
  maybePruneApiPerformanceLogs();
}

function queryWindowHours(query: QueryLike | null | undefined) {
  const value = Number.parseInt(query?.get("windowHours") || query?.get("hours") || "", 10);
  if (!Number.isFinite(value) || value <= 0) return API_PERFORMANCE_DEFAULT_WINDOW_HOURS;
  return Math.min(API_PERFORMANCE_MAX_WINDOW_HOURS, Math.max(1, value));
}

function queryMinDurationMs(query: QueryLike | null | undefined) {
  const value = Number.parseInt(query?.get("minDurationMs") || "", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.min(sorted.length - 1, index)] || 0;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dateToIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export async function listApiPerformanceMetrics(query: QueryLike, actor: ApiPerformanceActor) {
  assertRead(actor, "auditLogs");
  const { page, pageSize } = pageParams(query, 20, 100);
  const keyword = nonEmpty(query.get("keyword") || query.get("q") || query.get("search"));
  const source = nonEmpty(query.get("source"));
  const minDurationMs = queryMinDurationMs(query);
  const windowHours = queryWindowHours(query);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const where: Prisma.ApiPerformanceLogWhereInput = {
    createdAt: { gte: since },
    ...(keyword ? { path: { contains: keyword, mode: "insensitive" } } : {}),
    ...(source && API_PERFORMANCE_SOURCE_VALUES.has(source) ? { source } : {}),
    ...(minDurationMs > 0 ? { durationMs: { gte: minDurationMs } } : {}),
  };

  const logs = await prisma.apiPerformanceLog.findMany({
    where,
    orderBy: [{ durationMs: "desc" }, { createdAt: "desc" }],
    take: API_PERFORMANCE_MAX_SCAN_ROWS,
  });

  const groups = new Map<string, typeof logs>();
  for (const log of logs) {
    const key = [log.source, log.method, log.path].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(log);
  }

  const rows = [...groups.entries()]
    .map(([id, groupRows]) => {
      const first = groupRows[0]!;
      const durations = groupRows.map((row) => Number(row.durationMs || 0));
      const latestRow = [...groupRows].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
      const errorCount = groupRows.filter((row) => Number(row.statusCode || 0) >= 400).length;
      return {
        id,
        source: first.source,
        method: first.method,
        path: first.path,
        count: groupRows.length,
        avgDurationMs: Math.round(average(durations)),
        p95DurationMs: Math.round(percentile(durations, 0.95)),
        maxDurationMs: Math.max(...durations),
        errorCount,
        lastStatusCode: latestRow?.statusCode ?? null,
        lastSeenAt: dateToIso(latestRow?.createdAt),
      };
    })
    .sort((left, right) => (
      right.p95DurationMs - left.p95DurationMs
      || right.avgDurationMs - left.avgDurationMs
      || right.count - left.count
    ));

  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);
  return pageResult(pagedRows, rows.length, page, pageSize);
}
