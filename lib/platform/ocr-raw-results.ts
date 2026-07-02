import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";

type ActorLike = {
  role?: string | null;
} | null | undefined;

type OcrRawResultInput = {
  documentId: string;
  taxRefundId?: string | null;
  orderId?: string | null;
  documentType: string;
  provider?: string | null;
  apiName: string;
  rawJson?: unknown;
  parsedJson?: unknown;
  confidence?: number | null;
  status?: string | null;
  errorMessage?: string | null;
};

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function cleanText(value: unknown, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

export function canReadOcrRawResult(actor: ActorLike) {
  return actor?.role === "管理员" || actor?.role === "财务";
}

export async function saveOcrRawResult(input: OcrRawResultInput, tx: Prisma.TransactionClient = prisma) {
  const requestedStatus = cleanText(input.status, "SUCCESS");
  const rawJsonMissing = input.rawJson == null && requestedStatus !== "FAILED";
  const parsedJsonMissing = input.parsedJson == null && requestedStatus !== "FAILED";
  if (rawJsonMissing) {
    console.error("OCR response received but rawJson was not persisted.", {
      documentId: input.documentId,
      orderId: input.orderId || "",
      documentType: input.documentType,
      provider: cleanText(input.provider, "ALIYUN"),
      apiName: cleanText(input.apiName, "UNKNOWN_OCR_API"),
      status: requestedStatus,
    });
  }
  const status = rawJsonMissing || parsedJsonMissing
    ? "PARTIAL"
    : requestedStatus;
  const errorMessage = cleanText(input.errorMessage)
    || (rawJsonMissing ? "识别部分成功，原始结果保存失败" : "")
    || (parsedJsonMissing ? "识别部分成功，解析结果保存失败" : "");
  const created = await tx.ocrRawResult.create({
    data: {
      documentId: input.documentId,
      taxRefundId: input.taxRefundId || input.orderId || null,
      orderId: input.orderId || null,
      documentType: cleanText(input.documentType),
      provider: cleanText(input.provider, "ALIYUN"),
      apiName: cleanText(input.apiName, "UNKNOWN_OCR_API"),
      rawJson: jsonInput(input.rawJson),
      confidence: input.confidence == null ? null : input.confidence,
      status: parsedJsonMissing ? status : "PARTIAL",
      errorMessage: parsedJsonMissing ? errorMessage || null : "识别部分成功，解析结果未保存",
    },
  });
  if (parsedJsonMissing) return created;
  return tx.ocrRawResult.update({
    where: { id: created.id },
    data: {
      parsedJson: jsonInput(input.parsedJson),
      status,
      errorMessage: errorMessage || null,
    },
  });
}

export async function getOcrRawResultByDocumentId(documentId: string, tx: Prisma.TransactionClient = prisma) {
  const id = cleanText(documentId);
  if (!id) return null;
  return tx.ocrRawResult.findFirst({
    where: { documentId: id },
    orderBy: [{ createdAt: "desc" }],
  });
}

export function logOcrCallFailure(input: {
  documentId?: string | null;
  orderId?: string | null;
  documentType?: string | null;
  provider?: string | null;
  apiName?: string | null;
  errorCode?: unknown;
  errorMessage?: unknown;
}) {
  console.error("OCR call failed.", {
    documentId: input.documentId || "",
    orderId: input.orderId || "",
    documentType: input.documentType || "",
    provider: cleanText(input.provider, "ALIYUN"),
    apiName: cleanText(input.apiName, "UNKNOWN_OCR_API"),
    errorCode: cleanText(input.errorCode),
    errorMessage: cleanText(input.errorMessage),
  });
}

export function serializeOcrRawResult(row: {
  id?: string;
  documentId?: string | null;
  taxRefundId?: string | null;
  orderId?: string | null;
  documentType?: string | null;
  provider?: string | null;
  apiName?: string | null;
  rawJson?: Prisma.JsonValue | null;
  parsedJson?: Prisma.JsonValue | null;
  confidence?: Prisma.Decimal | number | string | null;
  status?: string | null;
  errorMessage?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
} | null) {
  if (!row) return null;
  return {
    id: row.id || "",
    documentId: row.documentId || "",
    taxRefundId: row.taxRefundId || "",
    orderId: row.orderId || "",
    documentType: row.documentType || "",
    provider: row.provider || "",
    apiName: row.apiName || "",
    rawJson: row.rawJson || null,
    parsedJson: row.parsedJson || null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    status: row.status || "",
    errorMessage: row.errorMessage || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}
