import { INVOICE_FIELD_ALIASES } from "./aliyun-invoice-ocr-fields.ts";
import {
  collectText,
  detailRowsFromPayload,
  fieldFromDetails,
  genericFieldFallback,
  keyValueEntriesFromPayload,
  keyValuePairsFromPayload,
  officialDataCandidates,
  parseJsonMaybe,
  partyValueFromStructuredEntries,
  responseField,
  valueByAliasesFromPairs,
  valueByAliasesFromRecord,
} from "./aliyun-invoice-ocr-helpers.ts";

export function extractAliyunInvoiceRecognitionData(responseBody: unknown) {
  const data = parseJsonMaybe(responseField(responseBody, "data"));
  const candidates = officialDataCandidates(data);
  const pairs = keyValuePairsFromPayload(data);
  const entries = keyValueEntriesFromPayload(data);
  const details = detailRowsFromPayload(data, candidates, pairs);
  const extractedFields: Record<string, unknown> = {};

  for (const [canonicalKey, aliases] of Object.entries(INVOICE_FIELD_ALIASES)) {
    const official = candidates.map((candidate) => valueByAliasesFromRecord(candidate, aliases)).find(Boolean);
    const detail = canonicalKey === "productName" || canonicalKey === "taxRate" || canonicalKey === "specModel" || canonicalKey === "unit" || canonicalKey === "quantity" || canonicalKey === "unitPrice"
      ? fieldFromDetails(details, canonicalKey)
      : "";
    const kv = valueByAliasesFromPairs(pairs, aliases);
    const fallback = genericFieldFallback(data, aliases);
    const value = official || detail || kv || fallback;
    if (value) extractedFields[canonicalKey] = value;
  }

  extractedFields.buyer ||= partyValueFromStructuredEntries(entries, "buyer", "name");
  extractedFields.seller ||= partyValueFromStructuredEntries(entries, "seller", "name");
  extractedFields.buyerTaxNo ||= partyValueFromStructuredEntries(entries, "buyer", "taxNo");
  extractedFields.sellerTaxNo ||= partyValueFromStructuredEntries(entries, "seller", "taxNo");

  return {
    data,
    extractedFields,
    text: collectText(data).join("\n"),
  };
}
