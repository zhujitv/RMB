import {
  extractPdfTextFromPdfBuffer,
  parseCustomsDeclarationDetailText,
  type CustomsDeclarationItemFields,
} from "../customs-declaration-parser";
import { assertWrite } from "./shared-auth";
import { codedError } from "./shared-base-utils";
import { bufferFromInput, type OcrTestUploadFile, type SettingsActor } from "./ocr-integration-shared";

type CustomsPdfFullTextItem = {
  itemNo: string | null;
  hsCode: string | null;
  productName: string | null;
  specification: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  totalPrice: number | null;
  currency: string | null;
};

function nullableText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function nullableNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function itemDto(item: CustomsDeclarationItemFields): CustomsPdfFullTextItem {
  return {
    itemNo: nullableText(item.itemNo),
    hsCode: nullableText(item.hsCode),
    productName: nullableText(item.productName),
    specification: nullableText(item.specification),
    quantity: nullableNumber(item.quantity),
    unit: nullableText(item.unit),
    unitPrice: nullableNumber(item.unitPrice),
    totalPrice: nullableNumber(item.totalAmount || item.fobAmount),
    currency: nullableText(item.currency),
  };
}

export async function testCustomsDeclarationPdfFullTextParse(actor: SettingsActor, file: OcrTestUploadFile) {
  assertWrite(actor, "settings");
  const fileBuffer = bufferFromInput(file.body);
  const rawText = await extractPdfTextFromPdfBuffer(fileBuffer, { requireText: false });
  if (!rawText.trim()) {
    throw codedError("该PDF未包含可读取文本，无法通过文本解析识别整张报关单。", 422, "CUSTOMS_PDF_TEXT_EMPTY");
  }

  const parsed = parseCustomsDeclarationDetailText(rawText);
  return {
    success: true,
    method: "PDF_TEXT_FULL_PARSE",
    fileName: file.originalFileName || "customs-declaration-test.pdf",
    textLength: rawText.length,
    header: {
      customsDeclarationNo: nullableText(parsed.customsDeclarationNo),
      declarationDate: nullableText(parsed.customsDeclarationDate),
      exportDate: nullableText(parsed.exportDate),
      domesticShipper: nullableText(parsed.domesticShipper),
      overseasConsignee: nullableText(parsed.overseasConsignee),
      tradeMode: nullableText(parsed.tradeMode),
      transactionMode: nullableText(parsed.tradeTerm),
      currency: nullableText(parsed.currency),
      totalAmount: nullableNumber(parsed.totalAmount),
    },
    items: parsed.items.map(itemDto),
    rawTextPreview: rawText.slice(0, 8000),
  };
}
