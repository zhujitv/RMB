import {
  ocrErrorText,
  type RasterizedPdfPage,
} from "./ocr-integration-shared";

export async function rasterizePdfPageForOcr(buffer: Buffer, pageNumber = 1): Promise<RasterizedPdfPage | null> {
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return null;
  try {
    const canvasModule = await import("@napi-rs/canvas");
    const { createCanvas, DOMMatrix, ImageData, Path2D } = canvasModule;
    const globalScope = globalThis as Record<string, unknown>;
    globalScope.DOMMatrix ||= DOMMatrix;
    globalScope.ImageData ||= ImageData;
    globalScope.Path2D ||= Path2D;
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as {
      getDocument: (params: Record<string, unknown>) => { promise: Promise<Record<string, unknown>>; destroy?: () => Promise<void> };
    };
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise as Record<string, unknown> & {
      numPages?: number;
      getPage: (pageNumber: number) => Promise<Record<string, unknown> & {
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: Record<string, unknown>) => { promise: Promise<void> };
      }>;
      destroy?: () => Promise<void>;
    };
    const pageCount = Number(pdf.numPages || 1);
    const safePageNumber = Math.max(1, Math.min(pageCount, Math.trunc(pageNumber || 1)));
    const page = await pdf.getPage(safePageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const longestSide = Math.max(baseViewport.width, baseViewport.height);
    const scale = Math.min(3, Math.max(1.5, 2200 / Math.max(longestSide, 1)));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: null, canvasContext: context, viewport }).promise;
    const pngBuffer = canvas.toBuffer("image/png");
    await pdf.destroy?.().catch(() => undefined);
    await loadingTask.destroy?.().catch(() => undefined);
    return {
      buffer: Buffer.from(pngBuffer),
      width: canvas.width,
      height: canvas.height,
      pageCount,
    };
  } catch (error) {
    console.error("pdf-rasterize-for-ocr-failed", { pageNumber, message: ocrErrorText(error) });
    return null;
  }
}

export async function rasterizeFirstPdfPageForOcr(buffer: Buffer): Promise<RasterizedPdfPage | null> {
  return rasterizePdfPageForOcr(buffer, 1);
}
