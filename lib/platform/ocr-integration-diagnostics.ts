import { randomUUID } from "node:crypto";
import { deleteR2Object, safeFileName, signedObjectReadUrl, uploadToR2 } from "../r2";
import { isPlainRecord, nonEmpty } from "./shared-base-utils";
import { assertWrite } from "./shared-auth";
import {
  type OcrTestUploadFile,
  type SettingsActor,
  bufferFromInput,
  normalizeFieldValue,
  ocrErrorText,
} from "./ocr-integration-shared";
import { parseNumberText } from "./ocr-integration-parsing";
import { customsDiagnosticResultFromError, jsonPreview } from "./ocr-integration-docmind";
import { recognizePdfTextWithOcr } from "./ocr-integration-runtime";

export function customsItemsFromParsedJson(parsedJson: unknown) {
  if (!isPlainRecord(parsedJson) || !Array.isArray(parsedJson.items)) return [];
  return parsedJson.items;
}

export async function testCustomsDeclarationOcr(actor: SettingsActor, file: OcrTestUploadFile) {
  assertWrite(actor, "settings");
  const fileBuffer = bufferFromInput(file.body);
  const fileName = safeFileName(file.originalFileName || "customs-declaration-test.pdf");
  const actorId = nonEmpty(actor?.id) || "system";
  const tempKey = `ocr-tests/customs/${actorId}/${Date.now()}-${randomUUID()}-${fileName}`;
  await uploadToR2({
    key: tempKey,
    body: fileBuffer,
    contentType: file.mimeType || "application/pdf",
  });
  try {
    const sourceUrl = await signedObjectReadUrl(tempKey, 900);
    const recognized = await recognizePdfTextWithOcr(fileBuffer, "customsDeclaration", {
      sourceUrl,
      fileName,
      requireText: true,
    });
    const parsedJson = recognized.parsedJson;
    const items = customsItemsFromParsedJson(parsedJson);
    const fields = isPlainRecord(parsedJson) ? parsedJson : {};
    return {
      fileName,
      source: recognized.source,
      provider: recognized.provider,
      apiName: recognized.apiName || recognized.source,
      parser: recognized.parser || "",
      confidence: recognized.confidence ?? null,
      textLength: recognized.text.length,
      docMindAttempted: recognized.diagnostics?.docMindAttempted === true,
      docMindSucceeded: recognized.diagnostics?.docMindSucceeded === true,
      docMindErrorCode: String(recognized.diagnostics?.docMindErrorCode || ""),
      docMindErrorMessage: String(recognized.diagnostics?.docMindErrorMessage || ""),
      fallbackUsed: recognized.diagnostics?.fallbackUsed === true,
      fields: {
        customsDeclarationNo: fields.customsDeclarationNo || "",
        customsDeclarationDate: fields.customsDeclarationDate || "",
        exportDate: fields.exportDate || "",
        tradeTerm: fields.tradeTerm || "",
        currency: fields.currency || "",
        totalAmount: fields.totalAmount || "",
      },
      itemsCount: items.length,
      itemsPreview: items.slice(0, 20),
      extractedFields: recognized.extractedFields || {},
      parsedJson,
      rawJsonPreview: jsonPreview(recognized.rawJson),
    };
  } catch (error) {
    const code = normalizeFieldValue((error as { code?: unknown } | null)?.code);
    if (code.startsWith("ALIYUN_DOCMIND_") || code.startsWith("ALIYUN_DOCUMENT_STRUCTURE_")) {
      return customsDiagnosticResultFromError(fileName, error);
    }
    throw error;
  } finally {
    await deleteR2Object(tempKey).catch((error) => {
      console.error("ocr-test-temp-file-delete-failed", {
        key: tempKey,
        message: ocrErrorText(error),
      });
    });
  }
}
