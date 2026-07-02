import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";

type ActorLike = {
  role?: string | null;
} | null | undefined;

type OcrRawResultInput = {
  documentId: string;
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
  return tx.ocrRawResult.create({
    data: {
      documentId: input.documentId,
      orderId: input.orderId || null,
      documentType: cleanText(input.documentType),
      provider: cleanText(input.provider, "ALIYUN"),
      apiName: cleanText(input.apiName, "UNKNOWN_OCR_API"),
      rawJson: jsonInput(input.rawJson),
      parsedJson: jsonInput(input.parsedJson),
      confidence: input.confidence == null ? null : input.confidence,
      status: cleanText(input.status, "SUCCESS"),
      errorMessage: cleanText(input.errorMessage) || null,
    },
  });
}

export function serializeOcrRawResult(row: {
  id?: string;
  documentId?: string | null;
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
