import {
  type OcrFeatureKey,
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  bufferFromInput,
  ensureOcrFeatureEnabled,
} from "./ocr-integration-shared";
import { recognizeAliyunCustomsDeclaration } from "./ocr-integration-customs";
import {
  recognizeAliyunVatInvoice,
  recognizeWithPdfTextFallback,
} from "./ocr-integration-clients";

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

export async function recognizeLogisticsInvoiceWithOcr(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
): Promise<OcrRecognitionResult> {
  const settings = await ensureOcrFeatureEnabled("logisticsInvoice");
  const fileBuffer = bufferFromInput(buffer);
  return recognizeAliyunVatInvoice(fileBuffer, settings);
}
