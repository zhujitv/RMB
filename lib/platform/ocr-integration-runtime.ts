import { randomUUID } from "node:crypto";
import { deleteR2Object, safeFileName, signedObjectReadUrl, uploadToR2 } from "../r2";
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
  rasterizeFirstPdfPageForSupplierOcr,
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

async function supplierDocumentOcrInput(buffer: Buffer, documentType: SupplierOcrDocumentType) {
  const rasterized = await rasterizeFirstPdfPageForSupplierOcr(buffer);
  if (!rasterized?.buffer?.length) return { buffer };
  const tempKey = `ocr-temp/supplier-documents/${safeFileName(documentType)}/${Date.now()}-${randomUUID()}.jpg`;
  try {
    await uploadToR2({
      key: tempKey,
      body: rasterized.buffer,
      contentType: "image/jpeg",
    });
    const url = await signedObjectReadUrl(tempKey, 600);
    return {
      buffer: rasterized.buffer,
      url,
      cleanup: () => deleteR2Object(tempKey).catch((error) => {
        console.warn("supplier-document-ocr-temp-image-delete-failed", {
          key: tempKey,
          message: error instanceof Error ? error.message : String(error || ""),
        });
      }),
    };
  } catch (error) {
    console.warn("supplier-document-ocr-temp-image-url-failed", {
      documentType,
      message: error instanceof Error ? error.message : String(error || ""),
    });
    return { buffer: rasterized.buffer };
  }
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
  const ocrInput = await supplierDocumentOcrInput(fileBuffer, documentType);
  const ocrSettings = supplierDocumentOcrSettings(settings);
  try {
    if (documentType === "SUPPLIER_INVOICE") {
      return await recognizeAliyunVatInvoice(ocrInput.buffer, ocrSettings, { maxAttempts: 1, url: ocrInput.url });
    }
    return await recognizeAliyunSupplierContract(ocrInput.buffer, ocrSettings, { maxAttempts: 1, url: ocrInput.url });
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
  } finally {
    await ocrInput.cleanup?.();
  }
}

export async function recognizeLogisticsInvoiceWithOcr(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
): Promise<OcrRecognitionResult> {
  const settings = await ensureOcrFeatureEnabled("logisticsInvoice");
  const fileBuffer = bufferFromInput(buffer);
  return recognizeAliyunVatInvoice(fileBuffer, settings);
}
