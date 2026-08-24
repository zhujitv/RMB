import sharp from "sharp";
import { getOcrIntegrationSettings } from "./ocr-integration-settings";
import { rasterizePdfPageForOcr } from "./ocr-integration-pdf";
import {
  codedError,
  isPlainRecord,
  logServerError,
  redactSensitiveText,
} from "./shared-base-utils";
import { createTencentOcrClient } from "./tencent-customs-ocr-experiment";
import {
  findSupplierContractSealTextBox,
  type SupplierContractPdfPageSize,
  type SupplierContractSealAnchor,
  type SupplierContractSealTextBox,
} from "./supplier-contract-seal-position-math";

const MAX_OCR_PAGES = 3;
const MIN_SEAL_OCR_TIMEOUT_MS = 30_000;
const SEAL_OCR_JPEG_QUALITY = 82;

function sealOcrFailure(error: unknown) {
  const record = isPlainRecord(error) ? error : {};
  const diagnostic = codedError("腾讯云合同盖章位置识别失败", 502, "SUPPLIER_CONTRACT_SEAL_OCR_PROVIDER_FAILED");
  diagnostic.details = {
    providerCode: String(record.code || "TENCENT_OCR_REQUEST_FAILED").slice(0, 160),
    providerMessage: redactSensitiveText(error instanceof Error ? error.message : String(record.message || error || ""), 500),
    requestId: String(record.requestId || "").slice(0, 160),
  };
  return diagnostic;
}

async function locateFromPdfText(pdfBody: Buffer): Promise<SupplierContractSealAnchor | null> {
  try {
    const canvasModule = await import("@napi-rs/canvas");
    const globalScope = globalThis as Record<string, unknown>;
    globalScope.DOMMatrix ||= canvasModule.DOMMatrix;
    globalScope.ImageData ||= canvasModule.ImageData;
    globalScope.Path2D ||= canvasModule.Path2D;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
      getDocument: (params: Record<string, unknown>) => { promise: Promise<Record<string, unknown>>; destroy?: () => Promise<void> };
    };
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBody),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise as Record<string, unknown> & {
      numPages?: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items?: Array<Record<string, unknown>> }>;
      }>;
      destroy?: () => Promise<void>;
    };
    const pageCount = Math.max(1, Number(pdf.numPages || 1));
    let found: SupplierContractSealAnchor | null = null;
    for (let pageNumber = pageCount; pageNumber >= 1 && !found; pageNumber -= 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const boxes = (content.items || []).map((item): SupplierContractSealTextBox | null => {
        const transform = Array.isArray(item.transform) ? item.transform.map(Number) : [];
        const text = String(item.str || "").trim();
        if (!text || transform.length < 6) return null;
        const height = Math.max(1, Math.abs(Number(item.height || transform[3] || transform[0] || 1)));
        return {
          text,
          x: Number(transform[4] || 0),
          y: Number(transform[5] || 0),
          width: Math.max(1, Number(item.width || 1)),
          height,
        };
      }).filter((box): box is SupplierContractSealTextBox => Boolean(box));
      const anchor = findSupplierContractSealTextBox(boxes);
      if (anchor) found = { ...anchor, pageIndex: pageNumber - 1, source: "PDF_TEXT" };
    }
    await pdf.destroy?.().catch(() => undefined);
    await loadingTask.destroy?.().catch(() => undefined);
    return found;
  } catch {
    return null;
  }
}

async function locateFromTencentOcr(pdfBody: Buffer, pageSizes: SupplierContractPdfPageSize[]) {
  const settings = await getOcrIntegrationSettings();
  const client = createTencentOcrClient({
    ...settings,
    timeoutMs: Math.max(settings.timeoutMs, MIN_SEAL_OCR_TIMEOUT_MS),
  });
  const firstPageNumber = pageSizes.length;
  const lastPageNumber = Math.max(1, pageSizes.length - MAX_OCR_PAGES + 1);
  for (let pageNumber = firstPageNumber; pageNumber >= lastPageNumber; pageNumber -= 1) {
    const rasterized = await rasterizePdfPageForOcr(pdfBody, pageNumber);
    if (!rasterized) continue;
    // Scanned contracts produce multi-megabyte PNGs. Sending the PNG can spend the
    // whole request timeout uploading/processing it, while a high-quality JPEG
    // preserves the text geometry and is typically an order of magnitude smaller.
    const optimizedImage = await sharp(rasterized.buffer)
      .jpeg({ quality: SEAL_OCR_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    const response = await client.GeneralBasicOCR({
      ImageBase64: optimizedImage.toString("base64"),
      LanguageType: "zh",
      IsWords: false,
    });
    const boxes = (response.TextDetections || []).map((item): SupplierContractSealTextBox | null => {
      const polygon = item.ItemPolygon;
      const text = String(item.DetectedText || "").trim();
      if (!text || !polygon) return null;
      return {
        text,
        x: Number(polygon.X || 0),
        y: Number(polygon.Y || 0),
        width: Math.max(1, Number(polygon.Width || 1)),
        height: Math.max(1, Number(polygon.Height || 1)),
      };
    }).filter((box): box is SupplierContractSealTextBox => Boolean(box));
    const anchor = findSupplierContractSealTextBox(boxes);
    if (!anchor) continue;
    const pageSize = pageSizes[pageNumber - 1];
    return {
      pageIndex: pageNumber - 1,
      x: anchor.x / rasterized.width * pageSize.width,
      y: pageSize.height - (anchor.y + anchor.height) / rasterized.height * pageSize.height,
      width: anchor.width / rasterized.width * pageSize.width,
      height: anchor.height / rasterized.height * pageSize.height,
      source: "TENCENT_OCR" as const,
    };
  }
  return null;
}

export async function locateSupplierContractSealAnchor(pdfBody: Buffer, pageSizes: SupplierContractPdfPageSize[]) {
  const textAnchor = await locateFromPdfText(pdfBody);
  if (textAnchor) return textAnchor;
  try {
    const ocrAnchor = await locateFromTencentOcr(pdfBody, pageSizes);
    if (ocrAnchor) return ocrAnchor;
  } catch (error) {
    logServerError("供应商合同盖章位置 OCR 失败", sealOcrFailure(error));
    throw codedError(
      "合同盖章位置识别服务暂不可用，已停止自动盖章以避免盖错。请稍后重试，或联系管理员检查腾讯云 OCR 配置。",
      409,
      "SUPPLIER_CONTRACT_SEAL_OCR_UNAVAILABLE",
    );
  }
  throw codedError(
    "未识别到合同中的“需方（盖章）”位置，已停止自动盖章以避免盖错。请上传文字清晰、方向正确的 PDF 后重试。",
    422,
    "SUPPLIER_CONTRACT_SEAL_POSITION_NOT_FOUND",
  );
}
