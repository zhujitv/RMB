import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { logServerError } from "./shared-base-utils";
import { SUPPLIER_DOCUMENT_OCR_MODULE } from "./supplier-document-ocr-shared";

const OCR_STATUS_PASSED = "OCR识别成功，校验通过";
const VALIDATION_CONFIRMED = "MANUAL_CONFIRMED";
const SUPPLIER_DOCUMENT_TYPES = ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"];

type RequestCompletionClient = Pick<Prisma.TransactionClient, "supplierDocumentRequest">;
export type CompletionRefreshOptions = {
  completedById?: string | null;
};

function normalizeSupplierReturnDocumentType(value: unknown) {
  const type = String(value || "").trim().toUpperCase();
  if (["SUPPLIER_PURCHASE_CONTRACT", "PURCHASE_CONTRACT", "FACTORY_PURCHASE_CONTRACT", "FACTORY_CONTRACT"].includes(type)) {
    return "SUPPLIER_PURCHASE_CONTRACT";
  }
  if (["SUPPLIER_INVOICE", "VAT_INVOICE", "SUPPLIER_VAT_INVOICE", "FACTORY_INVOICE", "FACTORY_VAT_INVOICE"].includes(type)) {
    return "SUPPLIER_INVOICE";
  }
  return type;
}

function requiredSupplierDocumentTypes(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return raw
    .map(normalizeSupplierReturnDocumentType)
    .filter((item) => SUPPLIER_DOCUMENT_TYPES.includes(item))
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function isOcrQualified(task: { status?: string | null; validationStatus?: string | null } | null | undefined) {
  return task?.status === OCR_STATUS_PASSED || task?.validationStatus === VALIDATION_CONFIRMED;
}

function hasStartedUpload(document: { uploadStatus?: unknown; uploadProgress?: unknown }) {
  const uploadStatus = String(document.uploadStatus || "PENDING");
  const uploadProgress = Number(document.uploadProgress || 0);
  return uploadStatus !== "PENDING" || uploadProgress > 0;
}

export async function refreshSupplierDocumentRequestCompletion(
  requestId: string,
  options: CompletionRefreshOptions = {},
  db: RequestCompletionClient = prisma,
) {
  const row = await db.supplierDocumentRequest.findUnique({
    where: { id: requestId },
    include: {
      documents: {
        where: { deletedAt: null },
        include: {
          ocrTasks: {
            where: { module: SUPPLIER_DOCUMENT_OCR_MODULE },
            orderBy: [{ createdAt: "desc" }],
            take: 1,
            select: {
              id: true,
              status: true,
              validationStatus: true,
              confirmedById: true,
              confirmedAt: true,
              updatedAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }],
      },
    },
  });
  if (!row) return null;
  if (row.deletedAt) return row;

  const requiredTypes = requiredSupplierDocumentTypes(row.requiredDocumentTypes);
  const latestByType = new Map<string, (typeof row.documents)[number]>();
  for (const document of row.documents) {
    const type = normalizeSupplierReturnDocumentType(document.documentType);
    if (!latestByType.has(type)) latestByType.set(type, document);
  }

  const items = requiredTypes.map((type) => {
    const document = latestByType.get(type);
    const task = document?.ocrTasks?.[0];
    const uploaded = document?.uploadStatus === "SUCCESS";
    const qualified = uploaded && isOcrQualified(task);
    return {
      type,
      document,
      task,
      started: Boolean(document && hasStartedUpload(document)),
      qualified,
    };
  });

  const allQualified = requiredTypes.length > 0 && items.every((item) => item.qualified);
  const anyStarted = items.some((item) => item.started);
  const nextStatus = allQualified ? "已完成" : anyStarted ? "部分上传" : "待上传";
  const completedById = allQualified
    ? options.completedById
      || items.find((item) => item.task?.confirmedById)?.task?.confirmedById
      || items.find((item) => item.document?.uploadedById)?.document?.uploadedById
      || null
    : null;

  const shouldUpdateCompletedAt = nextStatus === "已完成" && !row.completedAt;
  const shouldUpdateCompletedBy = nextStatus === "已完成" && completedById && row.completedById !== completedById;
  const shouldClearCompletion = nextStatus !== "已完成" && (row.completedAt || row.completedById);
  if (row.status === nextStatus && !shouldUpdateCompletedAt && !shouldUpdateCompletedBy && !shouldClearCompletion) {
    return row;
  }

  return db.supplierDocumentRequest.update({
    where: { id: requestId },
    data: nextStatus === "已完成"
      ? {
          status: nextStatus,
          completedAt: row.completedAt || new Date(),
          ...(completedById ? { completedById } : {}),
        }
      : {
          status: nextStatus,
          completedAt: null,
          completedById: null,
        },
  });
}

export async function safeRefreshSupplierDocumentRequestCompletion(requestId: string, options: CompletionRefreshOptions = {}) {
  try {
    return await refreshSupplierDocumentRequestCompletion(requestId, options);
  } catch (error) {
    logServerError("供应商资料回传任务完成状态重算失败", error, { requestId });
    return null;
  }
}
