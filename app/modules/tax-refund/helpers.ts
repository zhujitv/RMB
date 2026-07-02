import styles from "../../WorkspaceShell.module.css";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { PRODUCT_SUPPLIER_TYPES, SALESPERSON_TAX_REFUND_UPLOAD_TYPES, TAX_CUSTOMS_UPLOAD_TYPES, TAX_EXPORT_UPLOAD_TYPES, TAX_FACTORY_UPLOAD_TYPES, TAX_LOGISTICS_INVOICE_COST_TYPES, TAX_REFUND_STATUS_OPTIONS, type CustomsRecognitionResult, type DocumentCompleteness, type ManualShippingDraft, type ManualShippingForm, type TaxCost, type TaxDocument, type TaxRefundDetail, type TaxRefundRow, type UploadScope } from "./model";

export function normalizedMissingLabels(completeness: DocumentCompleteness) {
  const labels = completeness.missingLabels || completeness.missing || [];
  return labels.map((label) => String(label || "").trim()).filter(Boolean);
}

export function taxRefundBillOfLadingNumbers(row: Partial<TaxRefundRow> = {}, fallback: Partial<TaxRefundRow> = {}) {
  const arrayValues = [row.billOfLadingNumbers, fallback.billOfLadingNumbers]
    .find((items) => Array.isArray(items) && items.some((item) => String(item || "").trim()))
    || [];
  const values = arrayValues.length
    ? arrayValues
    : [row.billOfLadingNo, row.blNo, fallback.billOfLadingNo, fallback.blNo];
  return values
    .map((value) => String(value || "").trim())
    .filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
}

export function taxRefundBillOfLadingText(row: Partial<TaxRefundRow> = {}, fallback: Partial<TaxRefundRow> = {}) {
  const numbers = taxRefundBillOfLadingNumbers(row, fallback);
  return numbers.length ? numbers.join(" / ") : "-";
}

export function taxCompletenessTooltipGroups(completeness: DocumentCompleteness, percent: number) {
  if (percent >= 100 || Number(completeness.completed || 0) >= Number(completeness.total || 0)) return [];
  const groups: Array<{ category: string; items: string[] }> = [
    { category: "报关资料", items: [] },
    { category: "工厂合同", items: [] },
    { category: "工厂发票", items: [] },
    { category: "物流费用发票", items: [] },
    { category: "报关费", items: [] },
    { category: "拖车费", items: [] },
    { category: "港杂费", items: [] },
    { category: "海运费", items: [] },
    { category: "退税计算", items: [] },
  ];
  const groupByCategory = new Map(groups.map((group) => [group.category, group]));
  const pushItem = (category: string, item: string) => {
    const group = groupByCategory.get(category);
    const text = String(item || "").trim();
    if (!group || !text || group.items.includes(text)) return;
    group.items.push(text);
  };

  [...(completeness.customs?.missingTypes || []), ...(completeness.export?.missingTypes || [])].forEach((documentType) => {
    pushItem("报关资料", taxDocumentTypeLabel(documentType));
  });

  (completeness.supplier?.missing || []).forEach((item) => {
    if (item.missingFactoryCost) {
      pushItem("工厂合同", "产品供应商成本记录");
      return;
    }
    if (item.documentType === "SUPPLIER_PURCHASE_CONTRACT") {
      pushItem("工厂合同", "工厂合同");
    } else if (item.documentType === "SUPPLIER_INVOICE") {
      pushItem("工厂发票", "工厂增值税发票");
    } else if (item.label) {
      pushItem("工厂发票", item.label);
    }
  });

  (completeness.logistics?.missing || []).forEach((item) => {
    const bucket = String(item.missingBucket || item.requirementKey || "").toUpperCase();
    const label = item.label || item.invoiceLabel || "";
    if (bucket === "CUSTOMS") {
      pushItem("报关费", label || "缺少报关费发票");
    } else if (bucket === "TRUCKING" || bucket === "DOMESTIC_LOGISTICS") {
      pushItem("拖车费", label || "缺少拖车发票");
    } else if (bucket === "PORT") {
      pushItem("港杂费", label || "缺少港杂费发票");
    } else if (bucket === "SEA") {
      pushItem("海运费", label || "缺少海运费发票");
    } else {
      pushItem("物流费用发票", label || "物流费用发票");
    }
  });

  (completeness.calculation?.missing || []).forEach((item) => {
    pushItem("退税计算", item.label || "退税金额待计算");
  });

  if (!groups.some((group) => group.items.length)) {
    normalizedMissingLabels(completeness).forEach((label) => pushItem("报关资料", label));
  }
  return groups.filter((group) => group.items.length);
}

export function taxMissingTargets(completeness: DocumentCompleteness) {
  const targets: Array<{ label: string; targetKey: string }> = [];
  const pushTarget = (label: string, targetKey: string) => {
    const normalizedLabel = String(label || "").trim();
    if (!normalizedLabel) return;
    const key = `${targetKey}:${normalizedLabel}`;
    if (targets.some((target) => `${target.targetKey}:${target.label}` === key)) return;
    targets.push({ label: normalizedLabel, targetKey });
  };

  (completeness.export?.missingTypes || []).forEach((documentType) => {
    pushTarget(taxDocumentTypeLabel(documentType), taxDocumentTargetKey(documentType));
  });
  (completeness.customs?.missingTypes || []).forEach((documentType) => {
    pushTarget(taxDocumentTypeLabel(documentType), taxDocumentTargetKey(documentType));
  });
  (completeness.domesticLogistics?.missing || []).forEach(() => {
    pushTarget("物流信息", "domestic-logistics");
  });
  (completeness.supplier?.missing || []).forEach((item) => {
    if (item.missingFactoryCost) {
      pushTarget("缺少产品供应商成本记录", "factory-section");
      return;
    }
    const documentLabel = taxSupplierDocumentLabel(item.documentType || "");
    const targetKey = item.costId ? factoryDocumentTargetKey(item.costId, item.documentType || "") : "factory-section";
    pushTarget(item.label || (item.supplierName ? `${item.supplierName}${documentLabel}` : documentLabel), targetKey);
  });
  (completeness.logistics?.missing || []).forEach((item) => {
    if (item.missingCost) {
      pushTarget(item.label || item.invoiceLabel || "未录入物流费用", "logistics-section");
      return;
    }
    const targetKey = item.costId ? logisticsDocumentTargetKey(item.costId) : "logistics-section";
    pushTarget(item.invoiceLabel || item.label || logisticsDocumentLabel(item.documentType || "", item.costType || ""), targetKey);
  });
  (completeness.calculation?.missing || []).forEach((item) => {
    pushTarget(item.label || "退税金额待计算", "tax-refund-calculation");
  });

  if (!targets.length) {
    normalizedMissingLabels(completeness).forEach((label) => {
      pushTarget(label, taxTargetKeyFromMissingLabel(label));
    });
  }
  return targets;
}

export function taxRowStatus(row: TaxRefundRow) {
  if (row.taxRefundStatus) return row.taxRefundStatus;
  const completeness = row.documentCompleteness || {};
  const completed = Number(completeness.completed || 0);
  const total = Number(completeness.total || 0);
  return total > 0 && completed >= total ? "READY" : "NOT_READY";
}

export function taxDocumentTargetKey(documentType: string) {
  return `tax-document-${documentType}`;
}

export function taxDocumentTypeLabel(documentType: string) {
  return [...TAX_EXPORT_UPLOAD_TYPES, ...TAX_CUSTOMS_UPLOAD_TYPES].find((type) => type.value === documentType)?.label
    || documentType
    || "资料";
}

export function taxSupplierDocumentLabel(documentType: string) {
  return TAX_FACTORY_UPLOAD_TYPES.find((type) => type.value === documentType)?.label
    || (documentType === "SUPPLIER_PURCHASE_CONTRACT" ? "工厂采购合同" : "")
    || (documentType === "SUPPLIER_INVOICE" ? "工厂增值税发票" : "")
    || "工厂资料";
}

export function logisticsDocumentLabel(documentType: string, costType: string) {
  if (documentType === "SUPPLIER_INVOICE") return logisticsInvoiceLabel({ costType });
  return documentType || "物流资料";
}

export function taxTargetKeyFromMissingLabel(label: string) {
  const text = String(label || "").trim();
  const documentLabelMap: Array<[string, string]> = [
    ["提单", "BILL_OF_LADING"],
    ["清关发票", "COMMERCIAL_INVOICE"],
    ["商业发票", "COMMERCIAL_INVOICE"],
    ["装箱单", "PACKING_LIST"],
    ["箱单", "PACKING_LIST"],
    ["出口发票", "EXPORT_INVOICE"],
    ["销售合同", "SALES_CONTRACT"],
    ["报关单", "CUSTOMS_ENTRY_FORM"],
    ["货物报关单", "CUSTOMS_ENTRY_FORM"],
    ["放行通知书", "RELEASE_NOTICE"],
    ["报关委托书", "CUSTOMS_POWER_OF_ATTORNEY"],
  ];
  const matchedDocument = documentLabelMap.find(([keyword]) => text.includes(keyword));
  if (matchedDocument) return taxDocumentTargetKey(matchedDocument[1]);
  if (text.includes("国内物流")) return "domestic-logistics";
  if (text.includes("工厂") || text.includes("采购合同") || text.includes("增值税") || text.includes("进项发票")) {
    return "factory-section";
  }
  if (
    text.includes("报关费")
    || text.includes("拖车费")
    || text.includes("港杂费")
    || text.includes("海运费")
    || text.includes("物流")
  ) {
    return "logistics-section";
  }
  if (text.includes("退税") || text.includes("HS") || text.includes("发票") || text.includes("金额") || text.includes("数量") || text.includes("品名") || text.includes("单位")) {
    return "tax-refund-calculation";
  }
  return "tax-detail-top";
}

export function factoryDocumentTargetKey(costId: string, documentType: string) {
  return `tax-factory-${costId}-${documentType}`;
}

export function logisticsDocumentTargetKey(costId: string) {
  return `tax-logistics-${costId}-SUPPLIER_INVOICE`;
}

export function taxTargetDomId(key: string) {
  return `tax-target-${String(key || "unknown").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function factorySupplierCosts(costs: TaxCost[]) {
  return costs.filter((cost) => (
    cost.id
    && cost.supplierId
    && (
      PRODUCT_SUPPLIER_TYPES.includes(cost.supplierType || "")
      || ["工厂货款", "原材料货款", "采购货款", "产品货款"].includes(cost.costType || "")
    )
  ));
}

export function factoryCostSupplierKey(cost: TaxCost) {
  return cost.supplierId || cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || cost.id;
}

export function factoryCostOrdinal(cost: TaxCost, factoryCosts: TaxCost[]) {
  const key = factoryCostSupplierKey(cost);
  const sameSupplierCosts = factoryCosts.filter((item) => factoryCostSupplierKey(item) === key);
  return {
    index: Math.max(1, sameSupplierCosts.findIndex((item) => item.id === cost.id) + 1),
    total: sameSupplierCosts.length,
  };
}

export function formatFactoryCostAmount(cost: TaxCost) {
  const amountCny = Number(cost.amountCny || 0);
  const amount = Number(cost.amount || 0);
  if (amountCny > 0) return `CNY ${amountCny.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  if (amount > 0) return `${cost.currency || "CNY"} ${amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
  return "";
}

export function documentMatchesFactoryCostSlot(document: TaxDocument, cost: TaxCost, sameSupplierFactoryCostCount: number) {
  if (document.uploadStatus !== "SUCCESS") return false;
  if (document.costId) return document.costId === cost.id;
  return sameSupplierFactoryCostCount === 1 && Boolean(cost.supplierId && document.supplierId === cost.supplierId);
}

export function logisticsInvoiceCosts(costs: TaxCost[]) {
  return costs.filter((cost) => (
    cost.id
    && cost.supplierId
    && !factorySupplierCosts([cost]).length
    && TAX_LOGISTICS_INVOICE_COST_TYPES.includes(cost.costType || "")
  ));
}

export function normalizedTaxLogisticsCostType(value: unknown) {
  const text = String(value || "").trim();
  if (["国内物流费", "国内拖车费"].includes(text)) return "拖车费";
  if (text === "ENS费") return "ENS";
  return text;
}

export function uniqueTaxDocuments(documents: TaxDocument[]) {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (!document?.id || seen.has(document.id)) return false;
    seen.add(document.id);
    return true;
  });
}

export function logisticsRequirementMatchesCost(requirement: NonNullable<NonNullable<DocumentCompleteness["logistics"]>["requirements"]>[number], cost: TaxCost) {
  const costId = String(cost.id || "");
  const costType = normalizedTaxLogisticsCostType(cost.costType);
  if (!costId && !costType) return false;
  if ((requirement.costs || []).some((item) => (
    (costId && item.costId === costId)
    || normalizedTaxLogisticsCostType(item.costType || item.costTypeRaw) === costType
  ))) return true;
  if ((requirement.costTypes || []).some((item) => normalizedTaxLogisticsCostType(item) === costType)) return true;
  return (requirement.invoiceGroups || []).some((group) => {
    if (costId && (group.costIds || []).includes(costId)) return true;
    const includedTypes = [
      ...(group.includedFeeTypes || []),
      ...(group.feeTypes || []),
      ...(group.costTypes || []),
    ];
    return includedTypes.some((item) => normalizedTaxLogisticsCostType(item) === costType);
  });
}

export function logisticsInvoiceDocumentsForCost(cost: TaxCost, documents: TaxDocument[], completeness: DocumentCompleteness = {}) {
  const successInvoices = documents.filter((document) => (
    document.documentType === "SUPPLIER_INVOICE"
    && document.uploadStatus === "SUCCESS"
  ));
  const directDocuments = successInvoices.filter((document) => document.costId === cost.id);
  const documentById = new Map(successInvoices.map((document) => [document.id, document]));
  const groupedDocuments = (completeness.logistics?.requirements || [])
    .filter((requirement) => logisticsRequirementMatchesCost(requirement, cost))
    .flatMap((requirement) => (requirement.invoiceGroups || [])
      .map((group) => documentById.get(String(group.documentId || "")))
      .filter((document): document is TaxDocument => Boolean(document)));
  return uniqueTaxDocuments([...directDocuments, ...groupedDocuments]);
}

export function customsRecognitionStatusTextFromResult(result: CustomsRecognitionResult | null | undefined) {
  if (!result) return "";
  if (result.customsParseStatus === "FAILED") return "未识别成功，请手工填写报关单号和申报日期";
  const missing: string[] = [];
  if (!result.customsDeclarationNo) missing.push("未识别到报关单号");
  if (!result.customsDeclarationDate) missing.push("未识别到申报日期");
  if (missing.length) return missing.join(" / ");
  return "识别成功";
}

export function upsertTaxDocument(documents: TaxDocument[], document: TaxDocument) {
  const existing = documents.filter((item) => item.id !== document.id);
  const nextDocuments = document.documentType
    ? existing.filter((item) => !(
      item.documentType === document.documentType
      && item.uploadStatus === "SUCCESS"
      && (item.costId || "") === (document.costId || "")
      && (item.supplierId || "") === (document.supplierId || "")
    ))
    : existing;
  return [document, ...nextDocuments];
}

export function taxRefundRowPatchFromDetail(detail: Partial<TaxRefundDetail>) {
  const patch: Partial<TaxRefundRow> = {};
  if (detail.orderNo !== undefined) patch.orderNo = detail.orderNo;
  if (detail.blNo !== undefined) patch.blNo = detail.blNo;
  if (detail.billOfLadingNo !== undefined) patch.billOfLadingNo = detail.billOfLadingNo;
  if (detail.billOfLadingNumbers !== undefined) patch.billOfLadingNumbers = detail.billOfLadingNumbers;
  if (detail.customerName !== undefined) patch.customerName = detail.customerName;
  if (detail.customerFullName !== undefined) patch.customerFullName = detail.customerFullName;
  if (detail.customerShortName !== undefined) patch.customerShortName = detail.customerShortName;
  if (detail.businessEntityId !== undefined) patch.businessEntityId = detail.businessEntityId;
  if (detail.businessEntityName !== undefined) patch.businessEntityName = detail.businessEntityName;
  if (detail.businessEntityShortName !== undefined) patch.businessEntityShortName = detail.businessEntityShortName;
  if (detail.businessEntityDisplayName !== undefined) patch.businessEntityDisplayName = detail.businessEntityDisplayName;
  if (detail.businessEntityNameSnapshot !== undefined) patch.businessEntityNameSnapshot = detail.businessEntityNameSnapshot;
  if (detail.currency !== undefined) patch.currency = detail.currency;
  if (detail.customsDeclarationNo !== undefined) patch.customsDeclarationNo = detail.customsDeclarationNo;
  if (detail.customsDeclarationDate !== undefined) patch.customsDeclarationDate = detail.customsDeclarationDate;
  if (detail.declarationDate !== undefined) patch.declarationDate = detail.declarationDate;
  if (detail.customsParseStatusLabel !== undefined) patch.customsParseStatusLabel = detail.customsParseStatusLabel;
  if (detail.customsParseSourceLabel !== undefined) patch.customsParseSourceLabel = detail.customsParseSourceLabel;
  if (detail.customsParseMessage !== undefined) patch.customsParseMessage = detail.customsParseMessage;
  if (detail.taxRefundStatus !== undefined) patch.taxRefundStatus = detail.taxRefundStatus;
  if (detail.taxRefundStatusLabel !== undefined) patch.taxRefundStatusLabel = detail.taxRefundStatusLabel;
  if (detail.taxArchived !== undefined) patch.taxArchived = detail.taxArchived;
  if (detail.taxRefundArchivedByName !== undefined) patch.taxRefundArchivedByName = detail.taxRefundArchivedByName;
  if (detail.taxRefundArchivedAt !== undefined) patch.taxRefundArchivedAt = detail.taxRefundArchivedAt;
  if (detail.taxRefundArchiveRemark !== undefined) patch.taxRefundArchiveRemark = detail.taxRefundArchiveRemark;
  if (detail.taxSubmittedByName !== undefined) patch.taxSubmittedByName = detail.taxSubmittedByName;
  if (detail.taxSubmittedAt !== undefined) patch.taxSubmittedAt = detail.taxSubmittedAt;
  if (detail.documentCompleteness !== undefined) patch.documentCompleteness = detail.documentCompleteness;
  return patch;
}

export function customsEntryDocuments(documents: TaxDocument[]) {
  return latestTaxDocument(documents.filter((document) => (
    document.documentType === "CUSTOMS_ENTRY_FORM" && document.uploadStatus === "SUCCESS"
  )));
}

export function latestTaxDocument(documents: TaxDocument[]) {
  const latest = documents.slice().sort((left, right) => (
    new Date(right.uploadedAt || 0).getTime() - new Date(left.uploadedAt || 0).getTime()
  ))[0];
  return latest ? [latest] : [];
}

export function logisticsInvoiceLabel(cost: Pick<TaxCost, "costType">) {
  if (["拖车费", "国内物流费", "国内拖车费"].includes(cost.costType || "")) return "拖车费发票";
  if (cost.costType === "报关费") return "报关费发票";
  if (cost.costType === "港杂费") return "港杂费发票";
  if (cost.costType === "海运费") return "海运费发票";
  return "物流发票";
}

export function canUploadTaxDocument(role: string, canWriteDocuments: boolean, documentType: string, readOnly?: boolean) {
  if (readOnly || !canWriteDocuments) return false;
  if (role === "业务员") return SALESPERSON_TAX_REFUND_UPLOAD_TYPES.has(documentType);
  if (documentType === "EXPORT_INVOICE") return ["管理员", "财务"].includes(role);
  if (TAX_CUSTOMS_UPLOAD_TYPES.some((type) => type.value === documentType)) {
    return ["管理员", "业务员", "物流供应商", "物流资料录入员"].includes(role);
  }
  if (TAX_EXPORT_UPLOAD_TYPES.some((type) => type.value === documentType)) return ["管理员", "业务员"].includes(role);
  return true;
}

export function canDeleteTaxDocument(canWriteDocuments: boolean, readOnly?: boolean) {
  return !readOnly && canWriteDocuments;
}

export function canRecognizeTaxCustoms(role: string, canWriteDocuments: boolean, readOnly?: boolean) {
  return !readOnly && canWriteDocuments && ["管理员", "财务", "业务员"].includes(role);
}

export function uploadScopeKey(orderId: string, documentType: string, scope: UploadScope = {}) {
  return [orderId, documentType, scope.costId || "", scope.supplierId || ""].join(":");
}

export function zipFileNameFromResponse(response: Response, row: TaxRefundRow) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  if (plainMatch?.[1]) return plainMatch[1];
  const orderNo = String(row.orderNo || "订单").replace(/[\\/:*?"<>|]/g, "_");
  return `退税资料_${orderNo}.zip`;
}

export function groupDocuments(documents: TaxDocument[]) {
  const groups: Record<string, TaxDocument[]> = {
    出口资料: [],
    报关资料: [],
    工厂资料: [],
    物流资料: [],
    其他资料: [],
  };
  documents.forEach((document) => {
    const type = document.documentType || "";
    if (["BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "SALES_CONTRACT", "EXPORT_INVOICE"].includes(type)) {
      groups.出口资料.push(document);
    } else if (["CUSTOMS_ENTRY_FORM", "CUSTOMS_DECLARATION", "RELEASE_NOTICE", "CUSTOMS_POWER_OF_ATTORNEY"].includes(type)) {
      groups.报关资料.push(document);
    } else if (["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"].includes(type) && document.relatedModule === "SUPPLIER" && !document.costType?.includes("费")) {
      groups.工厂资料.push(document);
    } else if (document.relatedModule === "SUPPLIER" || ["CUSTOMS_FEE_INVOICE", "TRUCKING_FEE_INVOICE"].includes(type)) {
      groups.物流资料.push(document);
    } else {
      groups.其他资料.push(document);
    }
  });
  return groups;
}

export function manualShippingTemplate(draft: ManualShippingDraft, language: string): Pick<ManualShippingForm, "emailSubject" | "emailBody"> {
  const normalizedLanguage = String(language || "EN").toUpperCase();
  const orderNo = draft.orderNo || "-";
  const billOfLadingNo = draft.billOfLadingNo || draft.blNo || "-";
  const customsDeclarationDate = draft.customsDeclarationDate || "-";
  const labels = (draft.documents || [])
    .filter((item) => item.exists)
    .map((item) => item.emailLabel || item.label)
    .filter(Boolean) as string[];
  if (normalizedLanguage === "RU") {
    return {
      emailSubject: `Отгрузочные документы по заказу ${orderNo} / коносамент ${billOfLadingNo}`,
      emailBody: [
        "Здравствуйте!",
        "",
        `Во вложении направляем отгрузочные документы по заказу ${orderNo}.`,
        "",
        "Документы во вложении:",
        ...(labels.length ? labels : ["Commercial Invoice", "Packing List", "Customs Declaration"]).map((label) => `- ${label}`),
        "",
        `Номер коносамента: ${billOfLadingNo}`,
        `Дата декларации: ${customsDeclarationDate}`,
        "",
        "Пожалуйста, проверьте документы и сообщите нам, если потребуется дополнительная информация.",
        "",
        "С уважением,",
        "Zhejiang Lainuo Building Materials Co., Ltd.",
      ].join("\n"),
    };
  }
  return {
    emailSubject: `Shipping Documents for Order ${orderNo} / B/L ${billOfLadingNo}`,
    emailBody: [
      "Dear Customer,",
      "",
      "Please find attached the shipping documents for your customs clearance:",
      "",
      ...labels.map((label) => `- ${label}`),
      "",
      "This email also serves as the shipment notification.",
      "",
      "Best regards,",
      "NEXTWOOD",
    ].join("\n"),
  };
}

export function completenessClass(percent: number) {
  if (percent >= 100) return styles.statusSuccess;
  if (percent >= 50) return styles.statusWarning;
  return styles.statusDanger;
}

export function taxStatusLabel(status = "") {
  return TAX_REFUND_STATUS_OPTIONS.find((option) => option.value === status)?.label || status || "-";
}

export function taxRefundHasPackageContent(row: TaxRefundRow) {
  return Number(row.documentCompleteness?.completed || 0) > 0;
}

export function statusClass(status = "") {
  if (["READY", "REFUND_CALCULATED", "REFUND_RECEIVED"].includes(status)) return styles.statusSuccess;
  if (status === "PROBLEM") return styles.statusDanger;
  if (status === "SUBMITTED") return "";
  return styles.statusWarning;
}
