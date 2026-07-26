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
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OcrRecognitionResult> {
  if (options.signal?.aborted) throw options.signal.reason;
  const loadedSettings = await ensureOcrFeatureEnabled("logisticsInvoice");
  const requestedTimeoutMs = Math.max(1000, Math.trunc(Number(options.timeoutMs) || loadedSettings.timeoutMs));
  const settings = { ...loadedSettings, timeoutMs: Math.min(loadedSettings.timeoutMs, requestedTimeoutMs) };
  const fileBuffer = bufferFromInput(buffer);
  return recognizeAliyunVatInvoice(fileBuffer, settings, { signal: options.signal });
}
