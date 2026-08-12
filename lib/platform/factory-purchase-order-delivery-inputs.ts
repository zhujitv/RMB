import { codedError, isPlainRecord } from "./shared-base-errors";

type InternalDecision = "ACCEPTED" | "REJECTED";

function inputRecord(input: unknown, label: string) {
  if (!isPlainRecord(input)) throw codedError(`${label}格式错误`, 400, "FACTORY_DELIVERY_INPUT_INVALID");
  return input;
}

function expectedRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw codedError("采购单版本号无效，请刷新后重试", 400, "FACTORY_PURCHASE_ORDER_REVISION_INVALID");
  }
  return value;
}

function boundedRemark(value: unknown) {
  const remark = typeof value === "string" ? value.trim() : "";
  if (remark.length > 2_000) {
    throw codedError("内部决定备注不能超过 2000 个字符", 400, "FACTORY_DELIVERY_DECISION_REMARK_TOO_LONG");
  }
  return remark;
}

export function normalizeDeliveryProposalDecisionInput(input: unknown) {
  const body = inputRecord(input, "交期决定");
  const rawDecision = String(body.decision ?? body.action ?? "").trim().toUpperCase();
  const decision: InternalDecision | null = rawDecision === "ACCEPT" || rawDecision === "ACCEPTED"
    ? "ACCEPTED"
    : rawDecision === "REJECT" || rawDecision === "REJECTED" ? "REJECTED" : null;
  if (!decision) {
    throw codedError("请选择接受或拒绝供应商新交期", 400, "FACTORY_DELIVERY_DECISION_INVALID");
  }
  const remark = boundedRemark(body.remark ?? body.internalDecisionRemark);
  if (decision === "REJECTED" && !remark) {
    throw codedError("拒绝供应商新交期时必须填写原因", 400, "FACTORY_DELIVERY_DECISION_REMARK_REQUIRED");
  }
  return { decision, remark, expectedRevision: expectedRevision(body.expectedRevision) };
}

function requiredDate(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw codedError("实际交付日期格式错误", 400, "FACTORY_ACTUAL_DELIVERY_DATE_INVALID");
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw codedError("实际交付日期格式错误", 400, "FACTORY_ACTUAL_DELIVERY_DATE_INVALID");
  }
  return { date, text };
}

export function normalizeActualDeliveryInput(input: unknown) {
  const body = inputRecord(input, "实际交付登记");
  const actualDelivery = requiredDate(body.actualDeliveryDate ?? body.deliveryDate);
  return { ...actualDelivery, expectedRevision: expectedRevision(body.expectedRevision) };
}

export function shanghaiDateText(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
