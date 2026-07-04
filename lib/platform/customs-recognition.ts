import { prisma } from "../prisma";
import {
  LOGISTICS_OPERATOR_ROLE,
  codedError,
  dateToInput,
  includeOrderRelations,
  nonEmpty,
  permissionError,
  runNonCriticalTask,
  serializeCustomsRecognition,
  serializeOrder,
  writeAudit,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import { tryAutoShippingDocumentsNotification } from "./shipping-documents";

type AuditRequestLike = Parameters<typeof writeAudit>[0];
type CustomsActor = { id?: string | null; role?: string | null } | null | undefined;
type CustomsRecognitionInput = Record<string, unknown>;

const INTERNAL_CUSTOMS_EDIT_ROLES = ["管理员", "财务", "业务员"];

function actorRole(actor: CustomsActor) {
  return String(actor?.role || "");
}

function normalizeDate(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) {
    throw codedError("申报日期格式不正确。", 400, "INVALID_CUSTOMS_DECLARATION_DATE");
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeCustomsInput(input: CustomsRecognitionInput = {}) {
  return {
    customsDeclarationNo: nonEmpty(input.customsDeclarationNo || input.declarationNo),
    customsDeclarationDate: normalizeDate(input.customsDeclarationDate || input.declarationDate),
  };
}

function customsUpdateData(fields: ReturnType<typeof normalizeCustomsInput>) {
  const hasData = Boolean(fields.customsDeclarationNo || fields.customsDeclarationDate);
  return {
    customsDeclarationNo: fields.customsDeclarationNo || null,
    customsDeclarationDate: fields.customsDeclarationDate,
    customsParsedAt: hasData ? new Date() : null,
    customsParseStatus: hasData ? "MANUAL" : null,
    customsParseMessage: hasData ? "人工维护" : null,
    customsDeclarationParseSource: hasData ? "MANUAL" : null,
  };
}

function taxRefundCustomsOcrDisabled() {
  return codedError("退税资料报关单 OCR 已停用，请手工维护报关单信息。", 410, "TAX_REFUND_CUSTOMS_OCR_DISABLED");
}

export async function parseAndApplyCustomsDocument() {
  throw taxRefundCustomsOcrDisabled();
}

export async function previewCustomsRecognition() {
  throw taxRefundCustomsOcrDisabled();
}

export async function reparseCustomsRecognition() {
  throw taxRefundCustomsOcrDisabled();
}

export async function updateCustomsRecognition(request: AuditRequestLike, actor: CustomsActor, orderId: string, input: CustomsRecognitionInput = {}) {
  if (!INTERNAL_CUSTOMS_EDIT_ROLES.includes(actorRole(actor))) {
    throw permissionError("没有权限修改报关单信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能修改报关单字段");
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!before) throw permissionError("应收订单不存在或无权修改", 404);
  const fields = normalizeCustomsInput(input);
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: customsUpdateData(fields),
    include: includeOrderRelations(),
  });
  await runNonCriticalTask("报关单字段人工修改日志写入", () => writeAudit(
    request,
    actor,
    "手工修改申报日期/报关单号",
    "receivable_orders",
    order.id,
    serializeCustomsRecognition(before),
    serializeCustomsRecognition(order),
  ));
  const notifiedOrder = await tryAutoShippingDocumentsNotification(request, actor, order.id);
  return notifiedOrder || serializeOrder(order);
}

export function customsRecognitionManualFields(input: CustomsRecognitionInput = {}) {
  const fields = normalizeCustomsInput(input);
  return {
    customsDeclarationNo: fields.customsDeclarationNo,
    customsDeclarationDate: dateToInput(fields.customsDeclarationDate),
  };
}
