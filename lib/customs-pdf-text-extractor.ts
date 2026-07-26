process.env.PDF2JSON_DISABLE_LOGS ||= "1";

import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { normalizePdfText, parserError, type PdfParseOptions } from "./customs-declaration-parser-shared.ts";

export const MAX_CUSTOMS_PDF_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_CUSTOMS_PDF_PAGES = 80;
export const MAX_CUSTOMS_PDF_TEXT_ITEMS = 100_000;
export const MAX_CUSTOMS_PDF_TEXT_CHARS = 2_000_000;
export const DEFAULT_CUSTOMS_PDF_PARSE_TIMEOUT_MS = 15_000;

const pdf2JsonModulePath = createRequire(import.meta.url).resolve("pdf2json");

const PDF_TEXT_WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
process.env.PDF2JSON_DISABLE_LOGS = "1";
let parser;
let settled = false;

function decodeRun(value = "") {
  try { return decodeURIComponent(value); } catch { return value; }
}

function lineText(texts = []) {
  const sorted = texts.slice().sort((left, right) => (
    Number(left.y || 0) - Number(right.y || 0)
    || Number(left.x || 0) - Number(right.x || 0)
  ));
  const lines = [];
  let currentY = null;
  let currentLine = "";
  for (const item of sorted) {
    const y = Number(item.y || 0);
    const text = (item.R || []).map((run) => decodeRun(run.T || "")).join("");
    if (!text) continue;
    if (currentY === null || Math.abs(y - currentY) <= 0.35) {
      currentLine += text;
      currentY = currentY === null ? y : currentY;
    } else {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = text;
      currentY = y;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines.join("\n");
}

function finish(message) {
  if (settled) return;
  settled = true;
  try { parser?.destroy?.(); } catch {}
  parentPort.postMessage(message);
  parentPort.close();
}

function fail(message, status = 422, code = "CUSTOMS_PDF_TEXT_EXTRACT_FAILED") {
  finish({ ok: false, error: { message: String(message || "PDF文本提取失败"), status, code } });
}

try {
  const loaded = require(workerData.modulePath);
  const PDFParser = loaded.default || loaded.PDFParser || loaded;
  if (typeof PDFParser !== "function") throw new Error("pdf2json 未导出可用的 PDFParser 构造器。");
  parser = new PDFParser(null, true);
  parser.on("pdfParser_dataError", (error) => {
    const source = error instanceof Error ? error : error?.parserError;
    fail(source?.message || "PDF文本提取失败");
  });
  parser.on("pdfParser_dataReady", (data = {}) => {
    const pages = Array.isArray(data.Pages) ? data.Pages : [];
    if (pages.length > workerData.maxPages) {
      fail("PDF 页数超过安全识别上限，请拆分后重新上传。", 422, "CUSTOMS_PDF_PAGE_LIMIT_EXCEEDED");
      return;
    }
    const itemCount = pages.reduce((sum, page) => sum + (Array.isArray(page.Texts) ? page.Texts.length : 0), 0);
    if (itemCount > workerData.maxTextItems) {
      fail("PDF 内容过于复杂，无法安全自动识别，请手工填写报关信息。", 422, "CUSTOMS_PDF_COMPLEXITY_LIMIT_EXCEEDED");
      return;
    }
    const rawText = typeof parser.getRawTextContent === "function" ? parser.getRawTextContent() : "";
    const structuredText = pages.map((page) => lineText(page.Texts || [])).join("\n\n");
    const text = [rawText, structuredText].filter(Boolean).join("\n");
    if (text.length > workerData.maxTextChars) {
      fail("PDF 文本内容超过安全识别上限，请手工填写报关信息。", 422, "CUSTOMS_PDF_TEXT_LIMIT_EXCEEDED");
      return;
    }
    finish({ ok: true, text });
  });
  const pdfData = Buffer.from(workerData.pdfData);
  parser.parseBuffer(pdfData, 0);
} catch (error) {
  fail(error?.message || "PDF文本提取失败");
}
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
          modulePath: pdf2JsonModulePath,
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
