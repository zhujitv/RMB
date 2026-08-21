import { prisma } from "../prisma";
import { codedError } from "./shared-base-utils";
import { domesticContractIssues } from "./business-entity-domestic-bank";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import { normalizeSupplierTaxContractNumber } from "./supplier-tax-contract-number";
import {
  normalizeSupplierTaxContractDraftValues,
  supplierTaxContractSupplierName,
} from "./supplier-tax-contract-values";

const BUYER_INVOICE_ISSUE_PREFIX = "请先在设置 → 业务主体维护中国地区";

type SupplierInvoiceDetails = {
  supplierName: string;
  invoiceTitle: string | null;
  taxNumber: string | null;
  address: string | null;
  phone: string | null;
  bankName: string | null;
  bankAccount: string | null;
};

type BuyerInvoiceDetails = {
  name: string;
  taxNumber: string | null;
  address: string | null;
  contactPhone: string | null;
  domesticBankName: string | null;
  domesticBankAccount: string | null;
};

function isBuyerInvoiceIssue(issue: string) {
  return issue.startsWith(BUYER_INVOICE_ISSUE_PREFIX);
}

export function applySupplierTaxContractPartyDetails(
  draft: SupplierTaxContractDraft,
  supplier: SupplierInvoiceDetails,
  entity: BuyerInvoiceDetails,
) {
  const retainedIssues = (draft.blockingIssues || []).filter((issue) => !isBuyerInvoiceIssue(issue));
  const supplierName = supplierTaxContractSupplierName(supplier);
  const refreshed = normalizeSupplierTaxContractDraftValues({
    ...draft,
    supplierName,
    supplierTaxNumber: supplier.taxNumber || "",
    supplierAddress: supplier.address || "",
    supplierPhone: supplier.phone || "",
    supplierBankName: supplier.bankName || "",
    supplierBankAccount: supplier.bankAccount || "",
    buyerName: entity.name,
    buyerTaxNumber: entity.taxNumber || "",
    buyerAddress: entity.address || "",
    buyerPhone: entity.contactPhone || "",
    buyerBankName: entity.domesticBankName || "",
    buyerBankAccount: entity.domesticBankAccount || "",
    blockingIssues: [...new Set([...retainedIssues, ...domesticContractIssues(entity)])],
  } satisfies SupplierTaxContractDraft, { supplierName });
  return normalizeSupplierTaxContractNumber(refreshed as SupplierTaxContractDraft);
}

export async function refreshSupplierTaxContractParties(draft: SupplierTaxContractDraft) {
  const [supplier, entity] = await Promise.all([
    prisma.supplier.findFirst({
      where: { id: draft.supplierId, deletedAt: null },
      select: {
        supplierName: true,
        invoiceTitle: true,
        taxNumber: true,
        address: true,
        phone: true,
        bankName: true,
        bankAccount: true,
      },
    }),
    prisma.businessEntity.findFirst({
      where: { id: draft.buyerBusinessEntityId, deletedAt: null },
      select: {
        name: true,
        taxNumber: true,
        address: true,
        contactPhone: true,
        domesticBankName: true,
        domesticBankAccount: true,
      },
    }),
  ]);
  if (!supplier) {
    throw codedError("合同关联的供应商不存在。", 409, "SUPPLIER_TAX_CONTRACT_SUPPLIER_MISSING");
  }
  if (!entity) {
    throw codedError("合同关联的业务主体不存在。", 409, "SUPPLIER_TAX_CONTRACT_BUYER_MISSING");
  }
  return applySupplierTaxContractPartyDetails(draft, supplier, entity);
}
