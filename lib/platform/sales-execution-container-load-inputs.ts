import { Prisma } from "../generated/prisma/client.js";
import { codedError, isPlainRecord } from "./shared-base-errors";

function body(input: unknown) {
  if (!isPlainRecord(input)) {
    throw codedError("集装箱信息格式错误", 400, "CONTAINER_LOAD_INPUT_INVALID");
  }
  return input;
}

function text(value: unknown, maximum: number, label: string, required = false) {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > maximum) {
    throw codedError(
      required ? `请填写${label}，且不能超过 ${maximum} 个字符` : `${label}不能超过 ${maximum} 个字符`,
      400,
      "CONTAINER_LOAD_TEXT_INVALID",
    );
  }
  return result;
}

function revision(value: unknown, kind: "execution" | "container") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw codedError(
      kind === "execution" ? "销售执行单版本无效，请刷新后重试" : "集装箱版本无效，请刷新后重试",
      400,
      kind === "execution" ? "SALES_EXECUTION_REVISION_CONFLICT" : "CONTAINER_LOAD_REVISION_INVALID",
    );
  }
  return value;
}

function optionalDate(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { loadingDate: null, loadingDateText: "" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw codedError("装柜日期格式错误", 400, "CONTAINER_LOAD_DATE_INVALID");
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) {
    throw codedError("装柜日期格式错误", 400, "CONTAINER_LOAD_DATE_INVALID");
  }
  return { loadingDate: date, loadingDateText: raw };
}

function quantity(value: unknown, index: number) {
  try {
    const parsed = new Prisma.Decimal(typeof value === "number" ? String(value) : String(value || "").trim());
    if (!parsed.isFinite() || !parsed.gt(0) || parsed.decimalPlaces() > 4) throw new Error("invalid");
    return parsed;
  } catch {
    throw codedError(
      `第 ${index + 1} 行本柜计划数量必须大于 0，且最多保留四位小数`,
      400,
      "CONTAINER_LOAD_ALLOCATION_QUANTITY_INVALID",
    );
  }
}

function allocations(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) {
    throw codedError("请至少分配一条采购明细", 400, "CONTAINER_LOAD_ALLOCATIONS_REQUIRED");
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!isPlainRecord(raw)) {
      throw codedError(`第 ${index + 1} 行分配格式错误`, 400, "CONTAINER_LOAD_ALLOCATION_INVALID");
    }
    const purchaseOrderItemId = text(raw.purchaseOrderItemId, 191, "采购明细", true);
    if (seen.has(purchaseOrderItemId)) {
      throw codedError("本柜不能重复分配同一采购明细", 400, "CONTAINER_LOAD_ALLOCATION_DUPLICATE");
    }
    seen.add(purchaseOrderItemId);
    return { purchaseOrderItemId, plannedQuantity: quantity(raw.plannedQuantity, index) };
  });
}

function details(record: Record<string, unknown>) {
  return {
    containerNo: text(record.containerNo, 100, "柜号"),
    containerType: text(record.containerType, 100, "柜型"),
    sealNo: text(record.sealNo, 100, "封号"),
    ...optionalDate(record.loadingDate),
    allocations: allocations(record.allocations),
  };
}

export function normalizeContainerLoadCreateInput(input: unknown) {
  const record = body(input);
  return { expectedRevision: revision(record.expectedRevision, "execution"), ...details(record) };
}

export function normalizeContainerLoadUpdateInput(input: unknown) {
  const record = body(input);
  return { expectedRevision: revision(record.expectedRevision, "container"), ...details(record) };
}

export function normalizeContainerLoadOpenInput(input: unknown) {
  const record = body(input);
  return { expectedRevision: revision(record.expectedRevision, "container") };
}

export function normalizeContainerLoadReleaseInput(input: unknown) {
  const record = body(input);
  return {
    expectedRevision: revision(record.expectedRevision, "container"),
    remark: text(record.remark, 2000, "放行备注"),
  };
}

export function normalizeContainerLoadVoidInput(input: unknown) {
  const record = body(input);
  return {
    expectedRevision: revision(record.expectedRevision, "container"),
    reason: text(record.reason, 2000, "作废原因", true),
  };
}
