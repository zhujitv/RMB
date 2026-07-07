import { prisma } from "../prisma";
import {
  DEFAULT_COMPANY_PROFILE_SETTINGS,
  FACTORY_SUPPLIER_COST_TYPES,
  runNonCriticalTask,
} from "./shared-constants";
import { num } from "./shared-base-utils";
import { getCompanyProfileSettings } from "./company-profile";
import {
  contractOrderNoMatches,
  contractOrderSetKey,
} from "./supplier-contract-order-match";
import {
  isSuspiciousInvoiceParty as isSuspiciousInvoicePartyCore,
  isSuspiciousInvoiceProduct as isSuspiciousInvoiceProductCore,
} from "./supplier-vat-invoice-parser";
import {
  OCR_STATUS_EXCEPTION,
  OCR_STATUS_MANUAL,
  OCR_STATUS_PASSED,
  VALIDATION_EXCEPTION,
  VALIDATION_MANUAL,
  VALIDATION_PASSED,
  type OcrDocumentRow,
  type OcrValidationContext,
  type ValidationIssue,
  amountMatches,
  looselyMatches,
  normalizeTaxIdentifier,
  parseContractFields,
  parseVatInvoiceFields,
} from "./supplier-document-ocr-shared";

export function expectedAmountFromDocument(document: OcrDocumentRow) {
  if (document.cost) {
    const currency = String(document.cost.currency || "CNY").toUpperCase();
    const amount = currency === "CNY" ? num(document.cost.amount, 0) : num(document.cost.amountCny, 0);
    if (amount > 0) return amount;
  }
  const request = document.factoryDocumentRequest;
  const costs = request?.order?.costs || [];
  return costs
    .filter((cost) => cost.orderId === document.orderId
      && cost.supplierId === document.supplierId
      && FACTORY_SUPPLIER_COST_TYPES.includes(cost.costType)
      && cost.deletedAt == null)
    .reduce((sum, cost) => sum + num(cost.currency === "CNY" ? cost.amount : cost.amountCny, 0), 0);
}

export async function ocrValidationContext(document: OcrDocumentRow): Promise<OcrValidationContext> {
  const profile = await runNonCriticalTask("OCR校验公司资料读取", () => getCompanyProfileSettings(), { track: false });
  const supplierName = document.supplier?.supplierName || document.factoryDocumentRequest?.supplier?.supplierName || "";
  const supplierTaxNo = document.supplier?.taxNumber || document.factoryDocumentRequest?.supplier?.taxNumber || "";
  const businessEntityName = document.order.businessEntity?.name
    || document.order.businessEntityNameSnapshot
    || document.factoryDocumentRequest?.order?.businessEntity?.name
    || document.factoryDocumentRequest?.order?.businessEntityNameSnapshot
    || profile?.companyNameZh
    || DEFAULT_COMPANY_PROFILE_SETTINGS.companyNameZh;
  const orderNo = document.order.orderNo || document.factoryDocumentRequest?.order?.orderNo || "";
  return {
    document,
    supplierName,
    supplierTaxNo,
    businessEntityName,
    orderNo,
    purchaseOrderNo: orderNo,
    expectedAmount: expectedAmountFromDocument(document),
  };
}

export function enrichVatInvoiceFields(
  fields: ReturnType<typeof parseVatInvoiceFields>,
  context: OcrValidationContext,
  rawText: string,
) {
  const enriched = { ...fields };
  if (!enriched.seller && context.supplierName) {
    const recognizedSellerTaxNo = normalizeTaxIdentifier(enriched.sellerTaxNo);
    const expectedSupplierTaxNo = normalizeTaxIdentifier(context.supplierTaxNo);
    if (recognizedSellerTaxNo && expectedSupplierTaxNo && recognizedSellerTaxNo === expectedSupplierTaxNo) {
      enriched.seller = context.supplierName;
    } else if (rawText && looselyMatches(rawText, context.supplierName)) {
      enriched.seller = context.supplierName;
    }
  }
  if (!enriched.buyer && context.businessEntityName && rawText && looselyMatches(rawText, context.businessEntityName)) {
    enriched.buyer = context.businessEntityName;
  }
  return enriched;
}

export async function validateInvoice(fields: ReturnType<typeof parseVatInvoiceFields>, context: OcrValidationContext, documentId: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  if (!fields.seller) {
    issues.push({ level: "manual", field: "seller", message: "未识别到发票销售方，需人工确认" });
  } else if (!looselyMatches(fields.seller, context.supplierName)) {
    issues.push({ level: "error", field: "seller", message: "发票销售方与供应商不一致" });
  }
  if (!fields.buyer) {
    issues.push({ level: "manual", field: "buyer", message: "未识别到发票购买方，需人工确认" });
  } else if (!looselyMatches(fields.buyer, context.businessEntityName)) {
    issues.push({ level: "error", field: "buyer", message: "发票购买方与业务主体不一致" });
  }
  if (!fields.amountWithTax) {
    issues.push({ level: "manual", field: "amountWithTax", message: "未识别到发票含税金额，需人工确认" });
  } else if (context.expectedAmount > 0 && !amountMatches(fields.amountWithTax, context.expectedAmount)) {
    issues.push({ level: "error", field: "amountWithTax", message: "发票金额与采购订单金额不一致" });
  } else if (!context.expectedAmount) {
    issues.push({ level: "manual", field: "amountWithTax", message: "系统未找到可比对的采购订单金额，需人工确认" });
  }
  if (!fields.taxRate) {
    issues.push({ level: "manual", field: "taxRate", message: "未识别到税率，需人工确认" });
  } else if (!/^13(?:\.0+)?%$/.test(String(fields.taxRate).trim())) {
    issues.push({ level: "warning", field: "taxRate", message: "发票税率不是 13%，请人工确认" });
  }
  if (!fields.invoiceNo) {
    issues.push({ level: "manual", field: "invoiceNo", message: "未识别到发票号码，需人工确认" });
  } else {
    const duplicated = await prisma.ocrResult.findFirst({
      where: {
        fieldKey: "invoiceNo",
        value: fields.invoiceNo,
        task: {
          documentId: { not: documentId },
          documentType: "SUPPLIER_INVOICE",
        },
      },
      select: { id: true, task: { select: { documentId: true, orderId: true } } },
    });
    if (duplicated) {
      issues.push({ level: "error", field: "invoiceNo", message: "发票号码已存在，请核查" });
    }
  }
  return issues;
}

export function invoiceParserIssues(fields: ReturnType<typeof parseVatInvoiceFields>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (isSuspiciousInvoicePartyCore(fields.buyer)) {
    issues.push({ level: "error", field: "buyer", message: "发票购买方解析异常，请人工确认" });
  }
  if (isSuspiciousInvoicePartyCore(fields.seller)) {
    issues.push({ level: "error", field: "seller", message: "发票销售方解析异常，请人工确认" });
  }
  if (isSuspiciousInvoiceProductCore(fields.productName)) {
    issues.push({ level: "error", field: "productName", message: "发票产品名称解析异常，请人工确认" });
  }
  return issues;
}

export function validateContract(fields: ReturnType<typeof parseContractFields>, context: OcrValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!fields.supplier) {
    issues.push({ level: "manual", field: "supplier", message: "未识别到合同供应商，需人工确认" });
  } else if (!looselyMatches(fields.supplier, context.supplierName)) {
    issues.push({ level: "error", field: "supplier", message: "合同供应商与当前供应商不一致" });
  }
  if (!fields.buyer) {
    issues.push({ level: "manual", field: "buyer", message: "未识别到合同采购方，需人工确认" });
  } else if (!looselyMatches(fields.buyer, context.businessEntityName)) {
    issues.push({ level: "error", field: "buyer", message: "合同采购方与业务主体不一致" });
  }
  if (!fields.orderNo) {
    issues.push({ level: "manual", field: "orderNo", message: "未识别到合同订单号，需人工确认" });
  } else {
    const matched = contractOrderNoMatches(fields.orderNo, context.purchaseOrderNo);
    console.info("supplier-contract-order-compare", {
      systemOrderNo: context.purchaseOrderNo,
      ocrOrderNo: fields.orderNo,
      normalizedSystemOrderNo: contractOrderSetKey(context.purchaseOrderNo),
      normalizedOcrOrderNo: contractOrderSetKey(fields.orderNo),
      matched,
    });
    if (!matched) {
    issues.push({ level: "error", field: "orderNo", message: "合同订单号与采购订单号不一致" });
    }
  }
  if (!fields.contractAmount) {
    issues.push({ level: "manual", field: "contractAmount", message: "未识别到合同金额，需人工确认" });
  } else if (context.expectedAmount > 0 && !amountMatches(fields.contractAmount, context.expectedAmount)) {
    issues.push({ level: "error", field: "contractAmount", message: "合同金额与采购订单金额不一致" });
  } else if (!context.expectedAmount) {
    issues.push({ level: "manual", field: "contractAmount", message: "系统未找到可比对的采购订单金额，需人工确认" });
  }
  if (!fields.productName || !fields.specModel || !fields.quantity) {
    issues.push({ level: "manual", field: "productDetail", message: "产品名称、规格或数量无法准确判断，需人工确认" });
  }
  return issues;
}

export function taskStatusFromIssues(issues: ValidationIssue[]) {
  if (issues.some((issue) => issue.level === "error")) {
    return { status: OCR_STATUS_EXCEPTION, validationStatus: VALIDATION_EXCEPTION };
  }
  if (issues.some((issue) => issue.level === "warning" || issue.level === "manual")) {
    return { status: OCR_STATUS_MANUAL, validationStatus: VALIDATION_MANUAL };
  }
  return { status: OCR_STATUS_PASSED, validationStatus: VALIDATION_PASSED };
}
