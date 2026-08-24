import {
  type OcrFeatureKey,
  type OcrRecognitionOptions,
  type OcrRecognitionResult,
  bufferFromInput,
  ensureOcrFeatureEnabled,
  ensureTencentOcrFeatureEnabled,
} from "./ocr-integration-shared";
import { recognizeAliyunCustomsDeclaration } from "./ocr-integration-customs";
import { recognizeWithPdfTextFallback } from "./ocr-integration-clients";
import { recognizeTencentVatInvoiceForIntegration } from "./tencent-vat-invoice-ocr";

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
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OcrRecognitionResult> {
  if (options.signal?.aborted) throw options.signal.reason;
  const settings = await ensureTencentOcrFeatureEnabled("logisticsInvoice");
  const fileBuffer = bufferFromInput(buffer);
  return recognizeTencentVatInvoiceForIntegration(fileBuffer, {
    signal: options.signal,
    timeoutMs: Math.min(settings.timeoutMs, Math.max(1000, Math.trunc(Number(options.timeoutMs) || settings.timeoutMs))),
  });
}
