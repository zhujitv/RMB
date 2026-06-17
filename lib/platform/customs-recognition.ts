// @ts-nocheck
import fs from "node:fs/promises";
import { prisma } from "../prisma";
import { readR2Object } from "../r2";
import * as customsDeclarationParser from "../customs-declaration-parser";
import {
  CUSTOMS_FILE_READ_FAILED_MESSAGE,
  LOGISTICS_OPERATOR_ROLE,
  canWrite,
  codedError,
  customsParseStatusLabel,
  dateFromInput,
  dateToInput,
  includeOrderRelations,
  isCustomsDeclarationDocumentType,
  nonEmpty,
  normalizeOrderDocumentType,
  permissionError,
  runNonCriticalTask,
  serializeCustomsRecognition,
  serializeOrder,
  writeAudit,
} from "./shared";
import {
  canAccessDomesticLogisticsOrder,
  canUseDomesticLogisticsDocumentScope,
} from "./masters-access";
import { orderAccessWhere } from "./order-access";
import { tryAutoShippingDocumentsNotification } from "./shipping-documents";

function normalizeCustomsInput(input = {}) {
  return {
    customsDeclarationNo: nonEmpty(input.customsDeclarationNo).slice(0, 80) || null,
    customsDeclarationDate: customsDeclarationParser.normalizeCustomsDate(input.customsDeclarationDate) || "",
  };
}

function customsUpdateData(fields = {}, status = "SUCCESS", message = "", source = customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO) {
  return {
    customsDeclarationNo: fields.customsDeclarationNo || null,
    customsDeclarationDate: fields.customsDeclarationDate ? dateFromInput(fields.customsDeclarationDate) : null,
    customsParsedAt: new Date(),
    customsParseStatus: status,
    customsParseMessage: message || null,
    customsDeclarationParseSource: source,
  };
}

function hasCustomsRecognitionValue(fields = {}) {
  return Boolean(fields.customsDeclarationNo || fields.customsDeclarationDate);
}

function currentCustomsFields(before = null) {
  return {
    customsDeclarationNo: before?.customsDeclarationNo || "",
    customsDeclarationDate: before?.customsDeclarationDate ? dateToInput(before.customsDeclarationDate) : "",
  };
}

function buildCustomsRecognitionResult({
  document = {},
  parsedFields = {},
  currentFields = {},
  status = "FAILED",
  message = "",
  applied = false,
  requiresConfirmation = false,
  conflictFields = [],
  order = null,
} = {}) {
  return {
    attempted: true,
    documentId: document?.id || "",
    orderId: document?.orderId || order?.id || "",
    documentType: document?.documentType || "",
    customsDeclarationNo: parsedFields.customsDeclarationNo || "",
    customsDeclarationDate: parsedFields.customsDeclarationDate || "",
    currentCustomsDeclarationNo: currentFields.customsDeclarationNo || "",
    currentCustomsDeclarationDate: currentFields.customsDeclarationDate || "",
    customsParseStatus: status,
    customsParseStatusLabel: customsParseStatusLabel(status),
    customsParseMessage: message || customsDeclarationParser.customsParseMessage(parsedFields, status),
    applied: Boolean(applied),
    requiresConfirmation: Boolean(requiresConfirmation),
    conflictFields,
    order,
  };
}

function mergeCustomsFields(parsedFields = {}, before = null, force = false) {
  const preserved = [];
  const conflictFields = [];
  const currentFields = currentCustomsFields(before);
  const fields = { ...parsedFields };
  if (fields.customsDeclarationNo && currentFields.customsDeclarationNo && fields.customsDeclarationNo !== currentFields.customsDeclarationNo && !force) {
    conflictFields.push("customsDeclarationNo");
    fields.customsDeclarationNo = currentFields.customsDeclarationNo;
    preserved.push("customsDeclarationNo");
  } else if (!fields.customsDeclarationNo && currentFields.customsDeclarationNo) {
    fields.customsDeclarationNo = currentFields.customsDeclarationNo;
    preserved.push("customsDeclarationNo");
  }
  if (fields.customsDeclarationDate && currentFields.customsDeclarationDate && fields.customsDeclarationDate !== currentFields.customsDeclarationDate && !force) {
    conflictFields.push("customsDeclarationDate");
    fields.customsDeclarationDate = currentFields.customsDeclarationDate;
    preserved.push("customsDeclarationDate");
  } else if (!fields.customsDeclarationDate && currentFields.customsDeclarationDate) {
    fields.customsDeclarationDate = currentFields.customsDeclarationDate;
    preserved.push("customsDeclarationDate");
  }
  return { fields, preserved, conflictFields, currentFields };
}

async function parseCustomsDocumentBuffer(buffer, document = {}) {
  const result = await customsDeclarationParser.parseCustomsDeclarationPdfBuffer(buffer, document);
  const fields = {
    customsDeclarationNo: result.customsDeclarationNo || "",
    customsDeclarationDate: result.customsDeclarationDate || "",
  };
  return {
    fields,
    status: result.customsDeclarationParseStatus || customsDeclarationParser.customsParseStatusFromFields(fields),
    source: customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
    message: result.customsDeclarationParseMessage || customsDeclarationParser.customsParseMessage(fields),
  };
}

function customsFailurePublicMessage(error, fallback = "报关单识别失败") {
  if (error?.code === "CUSTOMS_PDF_READ_FAILED" || error?.code === "R2_OBJECT_NOT_FOUND" || error?.code === "R2_STREAM_FAILED") {
    return CUSTOMS_FILE_READ_FAILED_MESSAGE;
  }
  const message = String(error?.message || "");
  if (/ENOENT|no such file|pdf-parse|storage|R2|S3|对象存储|文件流|file path/i.test(message)) {
    return CUSTOMS_FILE_READ_FAILED_MESSAGE;
  }
  return fallback;
}

function customsFailureDetails(error, document = {}) {
  return {
    documentId: document?.id || "",
    orderId: document?.orderId || "",
    documentType: document?.documentType || "",
    storageKey: document?.storageKey || "",
    filePath: document?.filePath || "",
    fileUrl: document?.fileUrl || "",
    errorCode: error?.code || "",
    errorName: error?.name || "",
    errorMessage: error?.message || "",
  };
}

function wrapCustomsFileReadError(error, document = {}) {
  const wrapped = codedError(CUSTOMS_FILE_READ_FAILED_MESSAGE, error?.status || 500, "CUSTOMS_PDF_READ_FAILED");
  wrapped.details = customsFailureDetails(error, document);
  return wrapped;
}

async function readCustomsDeclarationPdfBuffer(document = {}) {
  try {
    if (document.filePath) {
      return await fs.readFile(document.filePath);
    }
    if (document.storageKey) {
      return await readR2Object(document.storageKey);
    }
    if (document.fileUrl) {
      const url = String(document.fileUrl || "");
      if (/^https?:\/\//i.test(url)) {
        const response = await fetch(url);
        if (!response.ok) throw codedError("报关单文件 URL 读取失败", response.status, "CUSTOMS_FILE_URL_READ_FAILED");
        return Buffer.from(await response.arrayBuffer());
      }
      return await fs.readFile(url);
    }
    throw codedError("报关单文件存储信息缺失，无法读取。", 404, "CUSTOMS_FILE_LOCATION_MISSING");
  } catch (error) {
    throw wrapCustomsFileReadError(error, document);
  }
}

async function applyCustomsParseFailure(request, actor, orderId, message, code = "CUSTOMS_PARSE_FAILED", action = "自动识别失败", options = {}) {
  const before = await prisma.receivableOrder.findUnique({ where: { id: orderId } });
  const allowManualFailure = Boolean(options?.allowManualFailure);
  const technicalError = options?.technicalError || null;
  const publicMessage = options?.publicMessage || message || "识别失败";
  const manualProtected = before?.customsDeclarationParseSource === "MANUAL" || before?.customsParseStatus === "MANUAL";
  if (!before || (manualProtected && !allowManualFailure)) {
    return before ? serializeOrder(before) : null;
  }
  const data = {
    customsParsedAt: new Date(),
    customsParseStatus: "FAILED",
    customsParseMessage: publicMessage,
    customsDeclarationParseSource: manualProtected
      ? before.customsDeclarationParseSource || customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
      : customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
  };
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data,
    include: includeOrderRelations(),
  });
  const beforeFailure = {
    customsParseStatus: before.customsParseStatus,
    customsParseMessage: before.customsParseMessage,
    customsDeclarationParseSource: before.customsDeclarationParseSource,
  };
  const afterFailure = {
    customsParseStatus: "FAILED",
    customsParseMessage: publicMessage,
    customsDeclarationParseSource: customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_AUTO,
    code,
  };
  if (technicalError) afterFailure.technicalError = customsFailureDetails(technicalError, options?.document || {});
  await runNonCriticalTask("报关单识别失败日志写入", () => writeAudit(request, actor, action, "receivable_orders", orderId, beforeFailure, afterFailure));
  return serializeOrder(order);
}

async function latestCustomsEntryDocument(orderId) {
  return prisma.orderDocument.findFirst({
    where: { orderId, documentType: "CUSTOMS_ENTRY_FORM", uploadStatus: "SUCCESS", deletedAt: null },
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

async function resolveCustomsDeclarationDocument({ orderId, documentId, documentType = "CUSTOMS_ENTRY_FORM" }) {
  const normalizedDocumentType = normalizeOrderDocumentType(documentType);
  if (!documentId) {
    return latestCustomsEntryDocument(orderId);
  }
  const document = await prisma.orderDocument.findFirst({
    where: {
      id: documentId,
      orderId,
      deletedAt: null,
    },
    include: { order: { include: { customer: true } }, cost: { include: { supplier: true } }, supplier: true, uploadedBy: true },
  });
  if (!document) return null;
  if (document.documentType !== normalizedDocumentType) {
    const error = permissionError("该文件不是报关单文件，无法执行报关单识别", 400);
    error.code = "INVALID_CUSTOMS_DOCUMENT_TYPE";
    throw error;
  }
  if (document.uploadStatus !== "SUCCESS") {
    const error = permissionError("该报关单文件尚未上传成功，无法识别", 400);
    error.code = "CUSTOMS_DOCUMENT_NOT_READY";
    throw error;
  }
  if (!document.storageKey && !document.filePath && !document.fileUrl) {
    const error = permissionError("报关单文件存储信息缺失，无法读取", 500);
    error.code = "CUSTOMS_FILE_LOCATION_MISSING";
    throw error;
  }
  return document;
}

export async function parseAndApplyCustomsDocument(
  request,
  actor,
  document,
  buffer,
  {
    force = false,
    action = "自动识别成功",
    failureAction = "自动识别失败",
    allowManualFailure = false,
    returnDetails = false,
  } = {},
) {
  const before = await prisma.receivableOrder.findUnique({ where: { id: document.orderId } });
  if (!before) throw permissionError("应收订单不存在", 404);
  const manualProtected = before.customsDeclarationParseSource === "MANUAL" || before.customsParseStatus === "MANUAL";
  try {
    const { fields, status, source, message } = await parseCustomsDocumentBuffer(buffer, document);
    if (!hasCustomsRecognitionValue(fields)) {
      const failureOrder = await applyCustomsParseFailure(request, actor, document.orderId, message, "CUSTOMS_PARSE_NO_FIELDS", failureAction, {
        allowManualFailure,
      });
      return returnDetails
        ? buildCustomsRecognitionResult({
          document,
          parsedFields: fields,
          currentFields: currentCustomsFields(before),
          status,
          message,
          applied: false,
          order: failureOrder,
        })
        : failureOrder;
    }
    const merged = mergeCustomsFields(fields, before, force);
    const updateSource = merged.preserved.length
      ? customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
      : source;
    if (merged.conflictFields.length && !force) {
      const shouldApplyPartial = Boolean(
        (fields.customsDeclarationNo && !merged.currentFields.customsDeclarationNo)
        || (fields.customsDeclarationDate && !merged.currentFields.customsDeclarationDate)
      );
      if (shouldApplyPartial) {
        const order = await prisma.receivableOrder.update({
          where: { id: document.orderId },
          data: customsUpdateData(
            merged.fields,
            customsDeclarationParser.customsParseStatusFromFields(merged.fields),
            "已识别新报关单信息，已有字段待确认覆盖。",
            updateSource,
          ),
          include: includeOrderRelations(),
        });
        await runNonCriticalTask("报关单识别待确认日志写入", () => writeAudit(request, actor, "自动识别报关单信息待确认", "receivable_orders", order.id, serializeCustomsRecognition(before), {
          ...serializeCustomsRecognition(order),
          documentId: document.id,
          conflictFields: merged.conflictFields,
        }));
        return returnDetails
          ? buildCustomsRecognitionResult({
            document,
            parsedFields: fields,
            currentFields: merged.currentFields,
            status,
            message,
            applied: true,
            requiresConfirmation: true,
            conflictFields: merged.conflictFields,
            order: serializeOrder(order),
          })
          : null;
      }
      return returnDetails
        ? buildCustomsRecognitionResult({
          document,
          parsedFields: fields,
          currentFields: merged.currentFields,
          status,
          message,
          applied: false,
          requiresConfirmation: true,
          conflictFields: merged.conflictFields,
        })
        : null;
    }
    if (manualProtected && !force && (merged.currentFields.customsDeclarationNo || merged.currentFields.customsDeclarationDate)) {
      return returnDetails
        ? buildCustomsRecognitionResult({
          document,
          parsedFields: fields,
          currentFields: merged.currentFields,
          status,
          message,
          applied: false,
          requiresConfirmation: true,
          conflictFields: ["customsDeclarationNo", "customsDeclarationDate"].filter((field) => merged.currentFields[field]),
        })
        : null;
    }
    const order = await prisma.receivableOrder.update({
      where: { id: document.orderId },
      data: customsUpdateData(
        merged.fields,
        customsDeclarationParser.customsParseStatusFromFields(merged.fields),
        message,
        updateSource,
      ),
      include: includeOrderRelations(),
    });
    await runNonCriticalTask("报关单识别日志写入", () => writeAudit(request, actor, status === "SUCCESS" ? action : "自动部分识别报关单信息", "receivable_orders", order.id, serializeCustomsRecognition(before), {
      ...serializeCustomsRecognition(order),
      documentId: document.id,
      uploadSource: document.uploadSource || "",
      recognitionSource: source,
      preservedManualFields: merged.preserved,
    }));
    const serializedOrder = serializeOrder(order);
    return returnDetails
      ? buildCustomsRecognitionResult({
        document,
        parsedFields: fields,
        currentFields: merged.currentFields,
        status,
        message,
        applied: true,
        order: serializedOrder,
      })
      : serializedOrder;
  } catch (error) {
    const publicMessage = customsFailurePublicMessage(error, error?.message || "报关单识别失败");
    const failureOrder = await applyCustomsParseFailure(request, actor, document.orderId, publicMessage, error?.code || "CUSTOMS_PARSE_FAILED", failureAction, {
      allowManualFailure,
      publicMessage,
      technicalError: error,
      document,
    });
    return returnDetails
      ? buildCustomsRecognitionResult({
        document,
        parsedFields: {},
        currentFields: currentCustomsFields(before),
        status: "FAILED",
        message: publicMessage,
        applied: false,
        order: failureOrder,
      })
      : failureOrder;
  }
}

export async function recognizeUploadedCustomsDocument(request, actor, documentId, input = {}) {
  if (!canWrite(actor, "documents") || !canWrite(actor, "domesticLogistics")) {
    throw permissionError("没有权限触发报关单识别", 403);
  }
  const document = await prisma.orderDocument.findFirst({
    where: { id: documentId, deletedAt: null },
    include: {
      order: {
        include: {
          customer: true,
          createdBy: true,
          salesperson: true,
          logisticsSuppliers: { select: { supplierId: true } },
        },
      },
      cost: { include: { supplier: true } },
      supplier: true,
      uploadedBy: true,
    },
  });
  if (!document) throw permissionError("报关单文件不存在", 404);
  if (!isCustomsDeclarationDocumentType(document.documentType)) {
    const error = permissionError("该文件不是报关单文件，无法执行报关单识别", 400);
    error.code = "INVALID_CUSTOMS_DOCUMENT_TYPE";
    throw error;
  }
  if (!canUseDomesticLogisticsDocumentScope(actor, document.documentType) || !canAccessDomesticLogisticsOrder(actor, document.order)) {
    throw permissionError("无权限触发该订单报关单识别", 403);
  }
  if (document.uploadStatus !== "SUCCESS") {
    const error = permissionError("该报关单文件尚未上传成功，无法识别", 400);
    error.code = "CUSTOMS_DOCUMENT_NOT_READY";
    throw error;
  }
  const buffer = await readCustomsDeclarationPdfBuffer(document);
  return parseAndApplyCustomsDocument(request, actor, document, buffer, {
    force: input.confirmOverride === true,
    action: input.confirmOverride === true ? "确认覆盖报关单识别信息" : "自动识别成功",
    failureAction: "自动识别失败",
    allowManualFailure: true,
    returnDetails: true,
  });
}

export async function updateCustomsRecognition(request, actor, orderId, input = {}) {
  if (!["管理员", "财务", "业务员"].includes(actor?.role)) {
    throw permissionError("没有权限修改报关单识别信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能修改报关单识别字段");
  const before = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!before) throw permissionError("应收订单不存在或无权修改", 404);
  const fields = normalizeCustomsInput(input);
  const status = customsDeclarationParser.customsParseStatusFromFields(fields);
  const order = await prisma.receivableOrder.update({
    where: { id: orderId },
    data: customsUpdateData(fields, status, "人工修改", customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL),
    include: includeOrderRelations(),
  });
  await runNonCriticalTask("报关单字段人工修改日志写入", () => writeAudit(request, actor, "手工修改申报日期/报关单号", "receivable_orders", order.id, serializeCustomsRecognition(before), serializeCustomsRecognition(order)));
  const notifiedOrder = await tryAutoShippingDocumentsNotification(request, actor, order.id);
  return notifiedOrder || serializeOrder(order);
}

export async function reparseCustomsRecognition(request, actor, orderId, input = {}) {
  if (!["管理员", "财务", "业务员"].includes(actor?.role)) {
    throw permissionError("没有权限修改报关单识别信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能重新识别报关单信息");
  const documentType = normalizeOrderDocumentType(nonEmpty(input.documentType || "CUSTOMS_ENTRY_FORM"));
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!order) throw permissionError("应收订单不存在或无权修改", 404);
  if (documentType && !isCustomsDeclarationDocumentType(documentType)) {
    const error = permissionError("仅支持 CUSTOMS_ENTRY_FORM 的报关单识别", 400);
    error.code = "INVALID_DOCUMENT_TYPE";
    throw error;
  }
  if ((order.customsDeclarationParseSource === "MANUAL" || order.customsParseStatus === "MANUAL") && input.confirmManualOverride !== true) {
    throw permissionError("当前报关单信息为人工修改状态，重新识别覆盖前需要二次确认。", 409);
  }
  const document = await resolveCustomsDeclarationDocument({
    orderId,
    documentId: nonEmpty(input.documentId),
    documentType,
  });
  if (!document) throw permissionError("未找到已上传成功的报关单 PDF", 404);
  let buffer;
  try {
    buffer = await readCustomsDeclarationPdfBuffer(document);
  } catch (error) {
    return applyCustomsParseFailure(request, actor, orderId, CUSTOMS_FILE_READ_FAILED_MESSAGE, error?.code || "CUSTOMS_PDF_READ_FAILED", "重新识别失败", {
      allowManualFailure: true,
      publicMessage: CUSTOMS_FILE_READ_FAILED_MESSAGE,
      technicalError: error,
      document,
    });
  }
  return parseAndApplyCustomsDocument(request, actor, document, buffer, {
    force: true,
    action: "重新识别并覆盖报关单信息",
    failureAction: "重新识别失败",
    allowManualFailure: true,
  });
}

export async function previewCustomsRecognition(actor, orderId, input = {}) {
  if (!["管理员", "财务", "业务员"].includes(actor?.role)) {
    throw permissionError("没有权限修改报关单识别信息", 403);
  }
  if (actor?.role === LOGISTICS_OPERATOR_ROLE) throw permissionError("物流供应商不能重新识别报关单信息");
  const documentType = normalizeOrderDocumentType(nonEmpty(input.documentType || "CUSTOMS_ENTRY_FORM"));
  if (documentType && !isCustomsDeclarationDocumentType(documentType)) {
    const error = permissionError("仅支持 CUSTOMS_ENTRY_FORM 的报关单预览识别", 400);
    error.code = "INVALID_DOCUMENT_TYPE";
    throw error;
  }
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
  });
  if (!order) throw permissionError("应收订单不存在或无权修改", 404);
  const document = await resolveCustomsDeclarationDocument({
    orderId,
    documentId: nonEmpty(input.documentId),
    documentType,
  });
  if (!document) throw permissionError("未找到已上传成功的报关单 PDF", 404);
  const buffer = await readCustomsDeclarationPdfBuffer(document);
  const { fields, source, status, message } = await parseCustomsDocumentBuffer(buffer, document);
  return {
    ...fields,
    orderId: order.id,
    documentId: document.id,
    source,
    status,
    message,
    currentStatus: order.customsParseStatus || "",
    currentStatusLabel: customsParseStatusLabel(order.customsParseStatus),
  };
}
