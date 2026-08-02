import { Worker } from "node:worker_threads";
import { normalizePdfText, parserError, type PdfParseOptions } from "./customs-declaration-parser-shared.ts";

export const MAX_CUSTOMS_PDF_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_CUSTOMS_PDF_PAGES = 80;
export const MAX_CUSTOMS_PDF_TEXT_ITEMS = 100_000;
export const MAX_CUSTOMS_PDF_TEXT_CHARS = 2_000_000;
export const DEFAULT_CUSTOMS_PDF_PARSE_TIMEOUT_MS = 15_000;

const pdfJsModuleSpecifier = ["pdfjs-dist", "legacy", "build", "pdf.mjs"].join("/");
const pdfJsWorkerModuleSpecifier = ["pdfjs-dist", "legacy", "build", "pdf.worker.mjs"].join("/");
const runtimeRequire = process
  .getBuiltinModule("node:module")
  .createRequire(import.meta.url);
const pdfJsModulePath = runtimeRequire.resolve(pdfJsModuleSpecifier);
const pdfJsWorkerModulePath = runtimeRequire.resolve(pdfJsWorkerModuleSpecifier);

const PDF_TEXT_WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { pathToFileURL } = require("node:url");
let loadingTask;
let settled = false;

function pageText(items = []) {
  const textItems = items.filter((item) => item && typeof item.str === "string" && item.str.trim());
  const naturalText = textItems.map((item) => item.str).join(" ");
  const sorted = textItems.slice().sort((left, right) => (
    Number(right.transform?.[5] || 0) - Number(left.transform?.[5] || 0)
    || Number(left.transform?.[4] || 0) - Number(right.transform?.[4] || 0)
  ));
  const lines = [];
  let currentY = null;
  let currentLine = [];
  for (const item of sorted) {
    const y = Number(item.transform?.[5] || 0);
    const text = item.str.trim();
    if (currentY === null || Math.abs(y - currentY) <= 2) {
      currentLine.push(text);
      currentY = currentY === null ? y : currentY;
    } else {
      if (currentLine.length) lines.push(currentLine.join(" "));
      currentLine = [text];
      currentY = y;
    }
  }
  if (currentLine.length) lines.push(currentLine.join(" "));
  const structuredText = lines.join("\n");
  return naturalText === structuredText ? naturalText : [naturalText, structuredText].filter(Boolean).join("\n");
}

function finish(message) {
  if (settled) return;
  settled = true;
  parentPort.postMessage(message);
  parentPort.close();
}

function fail(message, status = 422, code = "CUSTOMS_PDF_TEXT_EXTRACT_FAILED") {
  finish({ ok: false, error: { message: String(message || "PDF文本提取失败"), status, code } });
}

async function run() {
  try {
    globalThis.pdfjsWorker = await import(pathToFileURL(workerData.workerModulePath).href);
    const pdfjs = await import(pathToFileURL(workerData.modulePath).href);
    if (typeof pdfjs.getDocument !== "function") throw new Error("PDF.js 未导出可用的 getDocument 方法。");
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(workerData.pdfData),
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pageCount = Number(pdf?.numPages || 0);
    if (pageCount > workerData.maxPages) {
      fail("PDF 页数超过安全识别上限，请拆分后重新上传。", 422, "CUSTOMS_PDF_PAGE_LIMIT_EXCEEDED");
      return;
    }
    let itemCount = 0;
    let text = "";
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = Array.isArray(content?.items) ? content.items : [];
      itemCount += items.length;
      if (itemCount > workerData.maxTextItems) {
        fail("PDF 内容过于复杂，无法安全自动识别，请手工填写报关信息。", 422, "CUSTOMS_PDF_COMPLEXITY_LIMIT_EXCEEDED");
        return;
      }
      const extracted = pageText(items);
      text += (text && extracted ? "\n\n" : "") + extracted;
      if (text.length > workerData.maxTextChars) {
        fail("PDF 文本内容超过安全识别上限，请手工填写报关信息。", 422, "CUSTOMS_PDF_TEXT_LIMIT_EXCEEDED");
        return;
      }
      page.cleanup?.();
    }
    finish({ ok: true, text });
  } catch (error) {
    fail(error?.message || "PDF文本提取失败");
  } finally {
    try { await loadingTask?.destroy?.(); } catch {}
  }
}

void run();
`;

type WorkerResult = {
  ok?: boolean;
  text?: string;
  error?: { message?: string; status?: number; code?: string };
};

export async function extractPdfTextFromPdfBuffer(
  buffer: Buffer | ArrayBuffer | Uint8Array | null | undefined,
  options: PdfParseOptions = {},
) {
  const pdfData = Buffer.isBuffer(buffer)
    ? buffer
    : buffer instanceof Uint8Array
      ? Buffer.from(buffer)
      : buffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(buffer))
        : Buffer.alloc(0);
  if (pdfData.byteLength > MAX_CUSTOMS_PDF_INPUT_BYTES) {
    throw parserError("PDF 文件过大，无法自动识别，请手工填写报关信息。", 413, "CUSTOMS_PDF_INPUT_TOO_LARGE");
  }
  const normalizedText = normalizePdfText(await extractPdfTextInWorker(pdfData, options));
  if (options.requireText && !normalizedText) {
    throw parserError("PDF未提取到文字，请手工填写报关单号和申报日期。", 422, "CUSTOMS_PDF_NO_TEXT");
  }
  return normalizedText;
}

async function extractPdfTextInWorker(pdfData: Buffer, options: PdfParseOptions) {
  const timeoutMs = Math.min(Math.max(Math.trunc(Number(options.timeoutMs) || DEFAULT_CUSTOMS_PDF_PARSE_TIMEOUT_MS), 1000), 30_000);
  const maxPages = Math.min(Math.max(Math.trunc(Number(options.maxPages) || MAX_CUSTOMS_PDF_PAGES), 1), MAX_CUSTOMS_PDF_PAGES);
  const maxTextItems = Math.min(Math.max(Math.trunc(Number(options.maxTextItems) || MAX_CUSTOMS_PDF_TEXT_ITEMS), 1000), MAX_CUSTOMS_PDF_TEXT_ITEMS);
  if (options.signal?.aborted) throw options.signal.reason;
  const transferredPdf = Uint8Array.from(pdfData).buffer;
  return new Promise<string>((resolve, reject) => {
    let worker: Worker;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => void settle(() => reject(
      options.signal?.reason || parserError("PDF 文本提取已取消。", 499, "CUSTOMS_PDF_PARSE_ABORTED"),
    ));
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const settle = async (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { await worker.terminate(); } catch {}
      callback();
    };
    try {
      worker = new Worker(PDF_TEXT_WORKER_SOURCE, {
        eval: true,
        execArgv: [],
        name: "customs-pdf-text-parser",
        workerData: {
          modulePath: pdfJsModulePath,
          workerModulePath: pdfJsWorkerModulePath,
          pdfData: transferredPdf,
          maxPages,
          maxTextItems,
          maxTextChars: MAX_CUSTOMS_PDF_TEXT_CHARS,
        },
        transferList: [transferredPdf],
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      });
    } catch (error) {
      reject(parserError(error instanceof Error ? error.message : "PDF解析隔离进程启动失败", 503, "CUSTOMS_PDF_WORKER_START_FAILED"));
      return;
    }
    timeout = setTimeout(() => void settle(() => reject(parserError(
      "PDF 文本提取超时，请手工填写报关信息。",
      504,
      "CUSTOMS_PDF_PARSE_TIMEOUT",
    ))), timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (message: WorkerResult) => void settle(() => {
      if (message?.ok) resolve(String(message.text || ""));
      else reject(parserError(
        message?.error?.message || "PDF文本提取失败",
        Number(message?.error?.status || 422),
        String(message?.error?.code || "CUSTOMS_PDF_TEXT_EXTRACT_FAILED"),
      ));
    }));
    worker.once("error", (error: unknown) => void settle(() => reject(parserError(
      error instanceof Error ? error.message : "PDF解析隔离进程异常",
      422,
      "CUSTOMS_PDF_WORKER_FAILED",
    ))));
    worker.once("exit", (code) => {
      if (!settled) void settle(() => reject(parserError(
        `PDF解析隔离进程异常退出（${code}）。`,
        422,
        "CUSTOMS_PDF_WORKER_EXITED",
      )));
    });
    if (options.signal?.aborted) onAbort();
  });
}
