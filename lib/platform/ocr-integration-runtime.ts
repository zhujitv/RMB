import {
  type OcrFeatureKey,
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  type SupplierOcrDocumentType,
  bufferFromInput,
  ensureOcrFeatureEnabled,
} from "./ocr-integration-shared";
import { recognizeAliyunCustomsDeclaration } from "./ocr-integration-customs";
import {
  rasterizeFirstPdfPageForOcr,
  recognizeAliyunSupplierContract,
  recognizeAliyunVatInvoice,
  recognizeWithPdfTextFallback,
} from "./ocr-integration-clients";

function supplierDocumentOcrSettings(settings: Awaited<ReturnType<typeof ensureOcrFeatureEnabled>>) {
  return {
    ...settings,
    timeoutMs: Math.max(settings.timeoutMs, 30_000),
  };
}

async function supplierDocumentOcrBuffer(buffer: Buffer) {
  const rasterized = await rasterizeFirstPdfPageForOcr(buffer);
  return rasterized?.buffer || buffer;
}

export async function recognizePdfTextWithOcr(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
  feature: OcrFeatureKey,
  options: OcrRecognitionOptions = {},
) {
  const settings = await ensureOcrFeatureEnabled(feature);
  const fileBuffer = bufferFromInput(buffer);
  if (feature === "customsDeclaration") {
    try {
      return await recognizeAliyunCustomsDeclaration(fileBuffer, settings, options);
    } catch (error) {
      console.error("aliyun-customs-ocr-structured-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      if (settings.customsDeclarationMode === "STRICT") throw error;
      return recognizeWithPdfTextFallback(fileBuffer, feature, settings, {
        ...options,
        source: "ALIYUN_CUSTOMS_FALLBACK_PDF_TEXT",
        error,
      });
    }
  }
  return recognizeWithPdfTextFallback(buffer, feature, settings, options);
}

export async function recognizeSupplierDocumentWithOcr(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
  documentType: SupplierOcrDocumentType,
  options: { requireText?: boolean } = {},
): Promise<OcrRecognitionResult> {
  const settings = await ensureOcrFeatureEnabled("supplierDocumentReturn");
  const fileBuffer = bufferFromInput(buffer);
  const ocrBuffer = await supplierDocumentOcrBuffer(fileBuffer);
  const ocrSettings = supplierDocumentOcrSettings(settings);
  try {
    if (documentType === "SUPPLIER_INVOICE") {
      return await recognizeAliyunVatInvoice(ocrBuffer, ocrSettings, { maxAttempts: 1 });
    }
    return await recognizeAliyunSupplierContract(ocrBuffer, ocrSettings, { maxAttempts: 1 });
  } catch (error) {
    console.error("aliyun-ocr-structured-failed", {
      documentType,
      message: error instanceof Error ? error.message : String(error),
    });
    if (documentType === "SUPPLIER_INVOICE") throw error;
    return recognizeWithPdfTextFallback(fileBuffer, "supplierDocumentReturn", settings, {
      ...options,
      source: "ALIYUN_CONTRACT_FALLBACK_PDF_TEXT",
      error,
    });
  }
}

export async function recognizeLogisticsInvoiceWithOcr(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
): Promise<OcrRecognitionResult> {
  const settings = await ensureOcrFeatureEnabled("logisticsInvoice");
  const fileBuffer = bufferFromInput(buffer);
  return recognizeAliyunVatInvoice(fileBuffer, settings);
}
