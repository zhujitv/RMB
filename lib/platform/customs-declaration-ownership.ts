import { Prisma, type OrderDocumentType } from "../generated/prisma/client.js";
import { DOMESTIC_LOGISTICS_DOCUMENT_TYPES, SUPPLIER_DOCUMENT_TYPES } from "./shared-constants";
import { logServerError, runNonCriticalTask } from "./shared";
import { refreshTaxRefundCompletenessForCustomsDeclaration } from "./shared-tax-sync";

type Tx = Prisma.TransactionClient;

const AMOUNT_TOLERANCE = 0.01;

export const CUSTOMS_DECLARATION_DOCUMENT_TYPES = {
  CUSTOMS_DECLARATION_FORM: "CUSTOMS_DECLARATION_FORM",
  CUSTOMS_RELEASE_NOTICE: "CUSTOMS_RELEASE_NOTICE",
  CUSTOMS_AUTHORIZATION: "CUSTOMS_AUTHORIZATION",
  PACKING_LIST: "PACKING_LIST",
  COMMERCIAL_INVOICE: "COMMERCIAL_INVOICE",
  SALES_CONTRACT: "SALES_CONTRACT",
  SUPPLIER_PURCHASE_CONTRACT: "SUPPLIER_PURCHASE_CONTRACT",
  SUPPLIER_VAT_INVOICE: "SUPPLIER_VAT_INVOICE",
  OTHER: "OTHER",
} as const;

export function customsDeclarationDocumentType(documentType: unknown) {
  const type = String(documentType || "").trim().toUpperCase();
  if (type === "CUSTOMS_ENTRY_FORM" || type === "CUSTOMS_DECLARATION") return CUSTOMS_DECLARATION_DOCUMENT_TYPES.CUSTOMS_DECLARATION_FORM;
  if (type === "RELEASE_NOTICE") return CUSTOMS_DECLARATION_DOCUMENT_TYPES.CUSTOMS_RELEASE_NOTICE;
  if (type === "CUSTOMS_POWER_OF_ATTORNEY" || type === "CUSTOMS_AUTHORIZATION") return CUSTOMS_DECLARATION_DOCUMENT_TYPES.CUSTOMS_AUTHORIZATION;
  if (type === "SUPPLIER_INVOICE" || type === "SUPPLIER_VAT_INVOICE" || type === "VAT_INVOICE") return CUSTOMS_DECLARATION_DOCUMENT_TYPES.SUPPLIER_VAT_INVOICE;
  if (type in CUSTOMS_DECLARATION_DOCUMENT_TYPES) return type;
  return CUSTOMS_DECLARATION_DOCUMENT_TYPES.OTHER;
}

export function isCustomsBatchScopedDocumentType(documentType: unknown) {
  const type = String(documentType || "").trim().toUpperCase() as OrderDocumentType;
  return (
    DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(type)
    || ["PACKING_LIST", "COMMERCIAL_INVOICE", "SALES_CONTRACT"].includes(type)
    || SUPPLIER_DOCUMENT_TYPES.includes(type)
  );
}

export async function upsertCustomsDeclarationDocumentLink(
  tx: Tx,
  input: {
    customsDeclarationId: string;
    documentId: string;
    documentType: string;
    uploadedByUserId?: string | null;
    uploadedAt?: Date | null;
  },
) {
  if (!input.customsDeclarationId || !input.documentId) return null;
  return tx.customsDeclarationDocument.upsert({
    where: {
      customsDeclarationId_documentType_fileId: {
        customsDeclarationId: input.customsDeclarationId,
        documentType: customsDeclarationDocumentType(input.documentType),
        fileId: input.documentId,
      },
    },
    create: {
      customsDeclarationId: input.customsDeclarationId,
      documentType: customsDeclarationDocumentType(input.documentType),
      fileId: input.documentId,
      uploadedByUserId: input.uploadedByUserId || null,
      uploadedAt: input.uploadedAt || null,
    },
    update: {
      deletedAt: null,
      uploadedByUserId: input.uploadedByUserId || null,
      uploadedAt: input.uploadedAt || null,
    },
  });
}

function amountNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableAmount(value: unknown) {
  const parsed = amountNumber(value);
  return parsed > 0 ? new Prisma.Decimal(parsed.toFixed(2)) : null;
}

function amountMatches(a: unknown, b: unknown) {
  const left = amountNumber(a);
  const right = amountNumber(b);
  if (!left || !right) return true;
  return Math.abs(left - right) <= AMOUNT_TOLERANCE;
}

function supplierValidation(data: {
  requiredInvoiceAmount?: unknown;
  contractFileId?: string | null;
  vatInvoiceFileId?: string | null;
  contractAmount?: unknown;
  vatInvoiceAmount?: unknown;
  manualApprovedAt?: Date | null;
}) {
  if (data.manualApprovedAt) return { status: "MANUAL_APPROVED", message: "" };
  if (!data.contractFileId && !data.vatInvoiceFileId) return { status: "PENDING", message: "缺少供应商采购合同和供应商增值税发票" };
  if (!data.contractFileId) return { status: "PENDING", message: "缺少供应商采购合同" };
  if (!data.vatInvoiceFileId) return { status: "PENDING", message: "缺少供应商增值税发票" };
  if (!amountNumber(data.contractAmount)) return { status: "PENDING", message: "合同金额待识别或人工确认" };
  if (!amountNumber(data.vatInvoiceAmount)) return { status: "PENDING", message: "发票金额待识别或人工确认" };
  if (!amountMatches(data.requiredInvoiceAmount, data.contractAmount)) return { status: "AMOUNT_MISMATCH", message: "合同金额与要求开票金额不一致" };
  if (!amountMatches(data.requiredInvoiceAmount, data.vatInvoiceAmount)) return { status: "AMOUNT_MISMATCH", message: "发票金额与要求开票金额不一致" };
  if (!amountMatches(data.contractAmount, data.vatInvoiceAmount)) return { status: "AMOUNT_MISMATCH", message: "合同金额与发票金额不一致" };
  return { status: "PASSED", message: "" };
}

export async function upsertCustomsDeclarationSupplierLink(
  tx: Tx,
  input: {
    customsDeclarationId: string;
    supplierId: string;
    purchaseOrderId?: string | null;
    requiredInvoiceAmount?: unknown;
    documentType?: string | null;
    documentId?: string | null;
    documentAmount?: unknown;
    forcePendingReason?: string | null;
  },
) {
  if (!input.customsDeclarationId || !input.supplierId) return null;
  const existingActive = await tx.customsDeclarationSupplier.findFirst({
    where: {
      customsDeclarationId: input.customsDeclarationId,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId || null,
      deletedAt: null,
    },
  });
  const existing = existingActive || await tx.customsDeclarationSupplier.findFirst({
    where: {
      customsDeclarationId: input.customsDeclarationId,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId || null,
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  const existingForCarry = existing?.deletedAt ? null : existing;
  const normalizedDocumentType = customsDeclarationDocumentType(input.documentType);
  const contractDocumentChanged = normalizedDocumentType === CUSTOMS_DECLARATION_DOCUMENT_TYPES.SUPPLIER_PURCHASE_CONTRACT && Boolean(input.documentId);
  const invoiceDocumentChanged = normalizedDocumentType === CUSTOMS_DECLARATION_DOCUMENT_TYPES.SUPPLIER_VAT_INVOICE && Boolean(input.documentId);
  const documentChanged = contractDocumentChanged || invoiceDocumentChanged;
  const nextContractAmount = contractDocumentChanged
    ? nullableAmount(input.documentAmount)
    : existingForCarry?.contractAmount || null;
  const nextVatInvoiceAmount = invoiceDocumentChanged
    ? nullableAmount(input.documentAmount)
    : existingForCarry?.vatInvoiceAmount || null;
  const resetManualApproval = documentChanged || Boolean(input.forcePendingReason);
  const next = {
    requiredInvoiceAmount: nullableAmount(input.requiredInvoiceAmount) || existingForCarry?.requiredInvoiceAmount || null,
    contractFileId: contractDocumentChanged ? input.documentId : existingForCarry?.contractFileId || null,
    vatInvoiceFileId: invoiceDocumentChanged ? input.documentId : existingForCarry?.vatInvoiceFileId || null,
    contractAmount: nextContractAmount,
    vatInvoiceAmount: nextVatInvoiceAmount,
    manualApprovedAt: resetManualApproval ? null : existingForCarry?.manualApprovedAt || null,
  };
  const validation = input.forcePendingReason
    ? { status: "PENDING", message: input.forcePendingReason }
    : supplierValidation(next);
  const data = {
    customsDeclarationId: input.customsDeclarationId,
    supplierId: input.supplierId,
    purchaseOrderId: input.purchaseOrderId || null,
    requiredInvoiceAmount: next.requiredInvoiceAmount,
    contractFileId: next.contractFileId,
    vatInvoiceFileId: next.vatInvoiceFileId,
    contractAmount: next.contractAmount,
    vatInvoiceAmount: next.vatInvoiceAmount,
    validationStatus: validation.status,
    validationMessage: validation.message || null,
    ...(resetManualApproval ? {
      manualApprovedByUserId: null,
      manualApprovedAt: null,
      manualApprovalReason: null,
    } : {}),
    deletedAt: null,
  };
  if (existing) {
    return tx.customsDeclarationSupplier.update({ where: { id: existing.id }, data });
  }
  return tx.customsDeclarationSupplier.create({ data });
}

export async function refreshCustomsDeclarationAfterOwnershipChange(customsDeclarationId: string | null | undefined, label = "报关批次完整度刷新") {
  if (!customsDeclarationId) return;
  await runNonCriticalTask(label, () => refreshTaxRefundCompletenessForCustomsDeclaration(customsDeclarationId), {
    context: { customsDeclarationId },
  });
}

export async function logCustomsDeclarationOwnershipFailure(label: string, error: unknown, context: Record<string, unknown> = {}) {
  await runNonCriticalTask(label, () => {
    logServerError(label, error, context);
    return Promise.resolve(null);
  }, { context });
}
