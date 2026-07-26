import DocMindClient, {
  GetDocParserResultRequest,
  QueryDocParserStatusRequest,
} from "@alicloud/docmind-api20220711";
import { type CustomsDeclarationItemFields } from "../customs-declaration-parser";
import { codedError, isPlainRecord } from "./shared-base-utils";
import { logServerError } from "./shared-base-errors";
import { readAliyunDocMindOutputSafely } from "./outbound-request-security";
import {
  DOCMIND_CUSTOMS_MAX_POLLS,
  DOCMIND_CUSTOMS_POLL_INTERVAL_MS,
  normalizeFieldValue,
  ocrErrorDetails,
  ocrErrorText,
  parseJsonMaybe,
  responseField,
  sleep,
  toPlainJson,
} from "./ocr-integration-shared";
import { parseNumberText } from "./ocr-integration-parsing";

export function collectDocMindText(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 10 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectDocMindText(parsed, output, depth + 1);
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || /^https?:\/\//i.test(text)) return output;
    if (/[报关单申报日期商品名称数量单位总价成交方式币制海关编号]/.test(text) || text.length <= 2000) {
      output.push(text.slice(0, 200000));
    }
    return output;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDocMindText(item, output, depth + 1));
    return output;
  }
  if (isPlainRecord(value)) Object.values(value).forEach((item) => collectDocMindText(item, output, depth + 1));
  return output;
}

export function collectDocMindOutputFileUrls(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return collectDocMindOutputFileUrls(parsed, output, depth + 1);
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && !output.includes(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDocMindOutputFileUrls(item, output, depth + 1));
    return output;
  }
  if (!isPlainRecord(value)) return output;
  const outputFileUrl = normalizeFieldValue(responseField(value, "outputFileUrl"));
  if (/^https?:\/\//i.test(outputFileUrl) && !output.includes(outputFileUrl)) output.push(outputFileUrl);
  Object.values(value).forEach((item) => collectDocMindOutputFileUrls(item, output, depth + 1));
  return output;
}

export async function readDocMindOutputFiles(rawStatusJson: unknown[]) {
  const urls = [...new Set(rawStatusJson.flatMap((item) => collectDocMindOutputFileUrls(item)).slice(0, 3))];
  const outputs: unknown[] = [];
  for (const [outputIndex, url] of urls.entries()) {
    try {
      const { response, text } = await readAliyunDocMindOutputSafely(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      outputs.push(parseJsonMaybe(text));
    } catch (error) {
      logServerError("aliyun-docmind-customs-output-file-read-failed", error, { outputIndex });
    }
  }
  return outputs;
}

export function findDocMindTaskId(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  const parsed = parseJsonMaybe(value);
  if (parsed !== value) return findDocMindTaskId(parsed, depth + 1);
  if (typeof value === "string") {
    const text = value.trim();
    if (/^docmind-[\w-]+$/i.test(text)) return text;
    const matched = text.match(/docmind-[\w-]+/i);
    return matched?.[0] || "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = findDocMindTaskId(item, depth + 1);
      if (id) return id;
    }
    return "";
  }
  if (!isPlainRecord(value)) return "";
  const preferredKeys = ["id", "Id", "ID", "taskId", "TaskId", "jobId", "JobId", "parserId", "ParserId"];
  for (const key of preferredKeys) {
    const id = findDocMindTaskId(value[key], depth + 1);
    if (id) return id;
  }
  for (const item of Object.values(value)) {
    const id = findDocMindTaskId(item, depth + 1);
    if (id) return id;
  }
  return "";
}

export function docMindResponseError(body: unknown) {
  const code = normalizeFieldValue(responseField(body, "code"));
  const message = normalizeFieldValue(responseField(body, "message"));
  if (code && !["success", "ok", "200"].includes(code.toLowerCase())) {
    return [code, message].filter(Boolean).join(": ");
  }
  return "";
}

export function docMindStatusReady(data: unknown) {
  const status = normalizeFieldValue(responseField(data, "status")).toLowerCase();
  const processing = parseNumberText(responseField(data, "processing"));
  const successful = parseNumberText(responseField(data, "numberOfSuccessfulParsing"));
  if (processing >= 100 || successful > 0) return true;
  if (!status) return false;
  return ["success", "succeeded", "completed", "complete", "finish", "finished", "done"].some((item) => status.includes(item));
}

export function docMindResultHasData(data: unknown) {
  const parsed = parseJsonMaybe(data);
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (isPlainRecord(parsed)) return Object.keys(parsed).length > 0;
  return Boolean(normalizeFieldValue(parsed));
}

export async function getAliyunDocMindParserResult(
  client: DocMindClient,
  taskId: string,
): Promise<{ data: unknown; resultRawJson: unknown; statusRawJson: unknown[] }> {
  const statusRawJson: unknown[] = [];
  let lastError = "";
  for (let attempt = 0; attempt < DOCMIND_CUSTOMS_MAX_POLLS; attempt += 1) {
    let ready = attempt === 0;
    try {
      const statusResponse = await client.queryDocParserStatus(new QueryDocParserStatusRequest({ id: taskId }));
      const statusJson = toPlainJson(statusResponse);
      statusRawJson.push(statusJson);
      const statusBody = isPlainRecord(statusJson) ? statusJson.body : statusResponse.body;
      const statusError = docMindResponseError(statusBody);
      if (statusError) throw codedError(`阿里云文档智能任务状态查询失败：${statusError}`, 502, "ALIYUN_DOCMIND_STATUS_FAILED");
      ready = docMindStatusReady(responseField(statusBody, "data"));
    } catch (error) {
      lastError = ocrErrorText(error);
      console.error("aliyun-docmind-customs-status-failed", { taskId, attempt, message: lastError });
    }

    if (ready || attempt > 0) {
      try {
        const resultResponse = await client.getDocParserResult(new GetDocParserResultRequest({ id: taskId }));
        const resultRawJson = toPlainJson(resultResponse);
        const resultBody = isPlainRecord(resultRawJson) ? resultRawJson.body : resultResponse.body;
        const resultError = docMindResponseError(resultBody);
        if (resultError) throw codedError(`阿里云文档智能结果查询失败：${resultError}`, 502, "ALIYUN_DOCMIND_RESULT_FAILED");
        const data = parseJsonMaybe(responseField(resultBody, "data"));
        if (docMindResultHasData(data)) return { data, resultRawJson, statusRawJson };
      } catch (error) {
        lastError = ocrErrorText(error);
        console.error("aliyun-docmind-customs-result-pending", { taskId, attempt, message: lastError });
      }
      if (ready) {
        const outputFiles = await readDocMindOutputFiles(statusRawJson);
        if (outputFiles.length) return { data: { outputFiles }, resultRawJson: null, statusRawJson };
      }
    }
    if (attempt < DOCMIND_CUSTOMS_MAX_POLLS - 1) await sleep(DOCMIND_CUSTOMS_POLL_INTERVAL_MS);
  }
  throw codedError(
    `阿里云文档智能报关单任务未在限定时间内返回结果${lastError ? `：${lastError}` : ""}`,
    504,
    "ALIYUN_DOCMIND_RESULT_TIMEOUT",
  );
}


export function jsonPreview(value: unknown, limit = 50000) {
  try {
    const text = JSON.stringify(value ?? null, null, 2);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}\n... 已截断，完整结果请查看服务端日志。`;
  } catch {
    return String(value ?? "");
  }
}

export function safeObjectKeys(value: unknown) {
  if (Array.isArray(value)) return [`array(${value.length})`];
  if (!isPlainRecord(value)) return [];
  return Object.keys(value).slice(0, 50);
}

export function buildDocMindCustomsRawJson(
  submit: unknown,
  status: unknown[],
  result: unknown,
  taskId: string,
  data: unknown,
) {
  return {
    submit,
    status,
    result,
    taskId,
    data,
  };
}

export function throwDocMindCustomsEmptyError(params: {
  submitRawJson: unknown;
  statusRawJson: unknown[];
  resultRawJson: unknown;
  taskId: string;
  data: unknown;
  text: string;
  structuredFields: Record<string, unknown>;
  items: CustomsDeclarationItemFields[];
  parsedJson: unknown;
}) {
  const error = codedError("文档智能未返回可用的报关单结构化字段。", 422, "ALIYUN_DOCMIND_CUSTOMS_EMPTY");
  error.details = {
    source: "ALIYUN_DOCMIND_TRADE_DOCUMENT_CUSTOMS",
    provider: "ALIYUN",
    apiName: "ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT",
    parser: "CUSTOMS_DECLARATION_DOCMIND",
    taskId: params.taskId,
    textLength: params.text.length,
    dataType: Array.isArray(params.data) ? "array" : typeof params.data,
    dataKeys: safeObjectKeys(params.data),
    statusCount: params.statusRawJson.length,
    extractedFieldKeys: safeObjectKeys(params.structuredFields),
    itemsCount: params.items.length,
    parsedDataKeys: safeObjectKeys(params.parsedJson),
  };
  throw error;
}

export function customsDiagnosticResultFromError(fileName: string, error: unknown) {
  const details = ocrErrorDetails(error);
  return {
    fileName,
    source: normalizeFieldValue(details.source) || "ALIYUN_DOCMIND_TRADE_DOCUMENT_CUSTOMS",
    provider: normalizeFieldValue(details.provider) || "ALIYUN",
    apiName: normalizeFieldValue(details.apiName) || "ALIYUN_DOCMIND_TRADE_DOCUMENT_PACKAGE_EXTRACT",
    parser: normalizeFieldValue(details.parser) || "CUSTOMS_DECLARATION_DOCMIND",
    confidence: null,
    textLength: parseNumberText(details.textLength),
    docMindAttempted: true,
    docMindSucceeded: false,
    docMindErrorCode: normalizeFieldValue((error as { code?: unknown } | null)?.code) || "ALIYUN_DOCMIND_CUSTOMS_FAILED",
    docMindErrorMessage: ocrErrorText(error),
    fallbackUsed: false,
    fields: {
      customsDeclarationNo: "",
      customsDeclarationDate: "",
      exportDate: "",
      tradeTerm: "",
      currency: "",
      totalAmount: "",
    },
    itemsCount: parseNumberText(details.itemsCount),
    itemsPreview: [],
    extractedFields: {},
    parsedJson: {},
    rawJsonPreview: jsonPreview({
      error: {
        code: (error as { code?: unknown } | null)?.code || "",
        message: ocrErrorText(error),
      },
      metadata: {
        source: details.source,
        apiName: details.apiName,
        textLength: details.textLength,
        dataType: details.dataType,
        dataKeys: details.dataKeys,
        itemsCount: details.itemsCount,
      },
    }),
  };
}
