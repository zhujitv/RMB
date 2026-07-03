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
import { refreshTaxRefundCompleteness } from "./shared-tax-sync";

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

function hasInputValue(input: CustomsRecognitionInput, ...keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function normalizeMoney(value: unknown) {
  const raw = nonEmpty(value);
  if (!raw) return null;
  const parsed = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw codedError("报关金额格式不正确。", 400, "INVALID_CUSTOMS_DECLARATION_AMOUNT");
  }
  return Math.round(parsed * 100) / 100;
}

function normalizeContainerCount(value: unknown) {
  const raw = nonEmpty(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw codedError("柜数格式不正确。", 400, "INVALID_CUSTOMS_DECLARATION_CONTAINER_COUNT");
  }
  return parsed;
}

function normalizeCustomsInput(input: CustomsRecognitionInput = {}) {
  const hasDeclarationAmount = hasInputValue(input, "customsDeclarationAmount", "declarationAmount");
  const hasContainerCount = hasInputValue(input, "customsDeclarationContainerCount", "containerCount");
  return {
    customsDeclarationNo: nonEmpty(input.customsDeclarationNo || input.declarationNo),
    customsDeclarationDate: normalizeDate(input.customsDeclarationDate || input.declarationDate),
    customsDeclarationAmount: hasDeclarationAmount ? normalizeMoney(input.customsDeclarationAmount ?? input.declarationAmount) : undefined,
    customsDeclarationContainerCount: hasContainerCount ? normalizeContainerCount(input.customsDeclarationContainerCount ?? input.containerCount) : undefined,
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
  const declaration = await prisma.customsDeclaration.findFirst({
    where: {
      id: orderId,
      deletedAt: null,
      order: { is: { deletedAt: null, ...orderAccessWhere(actor) } },
    },
    select: {
      id: true,
      orderId: true,
      declarationNo: true,
      declarationDate: true,
      declarationAmount: true,
      containerCount: true,
      billOfLadingNo: true,
      taxArchived: true,
      taxSubmittedAt: true,
      taxRefundArchivedAt: true,
      taxRefundStatus: true,
    },
  });
  if (
    declaration
    && (
      declaration.taxArchived
      || declaration.taxSubmittedAt
      || declaration.taxRefundArchivedAt
      || declaration.taxRefundStatus === "SUBMITTED"
    )
  ) {
    throw codedError("该报关批次已提交退税或已归档，不能修改报关单信息。", 400, "CUSTOMS_DECLARATION_TAX_ARCHIVED");
  }
  const targetOrderId = declaration?.orderId || orderId;
  const before = await prisma.receivableOrder.findFirst({
    where: { id: targetOrderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!before) throw permissionError("应收订单不存在或无权修改", 404);
  const fields = normalizeCustomsInput(input);
  const order = await prisma.$transaction(async (tx) => {
    if (declaration) {
      await tx.customsDeclaration.update({
        where: { id: declaration.id },
        data: {
          declarationNo: fields.customsDeclarationNo || null,
          declarationDate: fields.customsDeclarationDate,
          ...(fields.customsDeclarationAmount !== undefined ? { declarationAmount: fields.customsDeclarationAmount } : {}),
          ...(fields.customsDeclarationContainerCount !== undefined ? { containerCount: fields.customsDeclarationContainerCount } : {}),
          source: "MANUAL",
        },
      });
      const unchangedOrder = await tx.receivableOrder.findUnique({
        where: { id: targetOrderId },
        include: includeOrderRelations(),
      });
      if (!unchangedOrder) throw permissionError("应收订单不存在或无权修改", 404);
      return unchangedOrder;
    }
    return tx.receivableOrder.update({
      where: { id: targetOrderId },
      data: customsUpdateData(fields),
      include: includeOrderRelations(),
    });
  });
  await runNonCriticalTask("报关单字段人工修改日志写入", () => writeAudit(
    request,
    actor,
    "手工修改申报日期/报关单号",
    declaration ? "customs_declarations" : "receivable_orders",
    declaration?.id || order.id,
    declaration ? {
      customsDeclarationId: declaration.id,
      customsDeclarationNo: declaration.declarationNo || "",
      customsDeclarationDate: dateToInput(declaration.declarationDate),
      customsDeclarationAmount: declaration.declarationAmount == null ? null : Number(declaration.declarationAmount || 0),
      customsDeclarationContainerCount: declaration.containerCount ?? null,
    } : serializeCustomsRecognition(before),
    declaration ? {
      customsDeclarationId: declaration.id,
      customsDeclarationNo: fields.customsDeclarationNo || "",
      customsDeclarationDate: dateToInput(fields.customsDeclarationDate),
      ...(fields.customsDeclarationAmount !== undefined ? { customsDeclarationAmount: fields.customsDeclarationAmount } : {}),
      ...(fields.customsDeclarationContainerCount !== undefined ? { customsDeclarationContainerCount: fields.customsDeclarationContainerCount } : {}),
    } : serializeCustomsRecognition(order),
  ));
  await runNonCriticalTask("报关单字段变更后退税完整度刷新", () => refreshTaxRefundCompleteness(targetOrderId), {
    context: { orderId: targetOrderId, customsDeclarationId: declaration?.id || "" },
  });
  const notifiedOrder = declaration ? null : await tryAutoShippingDocumentsNotification(request, actor, order.id);
  const serialized = notifiedOrder || serializeOrder(order);
  if (!declaration) return serialized;
  return {
    ...serialized,
    id: declaration.id,
    orderId: order.id,
    customsDeclarationId: declaration.id,
    blNo: declaration.billOfLadingNo || serialized.blNo || "",
    billOfLadingNo: declaration.billOfLadingNo || serialized.billOfLadingNo || "",
    customsDeclarationNo: fields.customsDeclarationNo || "",
    customsDeclarationDate: dateToInput(fields.customsDeclarationDate),
    ...(fields.customsDeclarationAmount !== undefined ? {
      customsDeclarationAmount: fields.customsDeclarationAmount,
      declarationAmount: fields.customsDeclarationAmount,
    } : {}),
    ...(fields.customsDeclarationContainerCount !== undefined ? {
      customsDeclarationContainerCount: fields.customsDeclarationContainerCount,
      containerCount: fields.customsDeclarationContainerCount,
    } : {}),
  };
}

export function customsRecognitionManualFields(input: CustomsRecognitionInput = {}) {
  const fields = normalizeCustomsInput(input);
  return {
    customsDeclarationNo: fields.customsDeclarationNo,
    customsDeclarationDate: dateToInput(fields.customsDeclarationDate),
    customsDeclarationAmount: fields.customsDeclarationAmount,
    customsDeclarationContainerCount: fields.customsDeclarationContainerCount,
  };
}
