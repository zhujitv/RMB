import { prisma } from "../prisma";
import { codedError } from "./shared-base-utils";
import { domesticContractIssues } from "./business-entity-domestic-bank";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";

const DOMESTIC_ISSUE_PREFIX = "请先在设置 → 业务主体维护中国地区";

export async function refreshSupplierTaxContractBuyer(draft: SupplierTaxContractDraft) {
  const entity = await prisma.businessEntity.findFirst({
    where: { id: draft.buyerBusinessEntityId, deletedAt: null },
    select: {
      name: true, taxNumber: true, address: true, contactPhone: true,
      domesticBankName: true, domesticBankAccount: true,
    },
  });
  if (!entity) throw codedError("合同关联的业务主体不存在。", 409, "SUPPLIER_TAX_CONTRACT_BUYER_MISSING");
  const retainedIssues = (draft.blockingIssues || []).filter((issue) => !issue.startsWith(DOMESTIC_ISSUE_PREFIX));
  return {
    ...draft,
    buyerName: entity.name,
    buyerTaxNumber: entity.taxNumber || "",
    buyerAddress: entity.address || "",
    buyerPhone: entity.contactPhone || "",
    buyerBankName: entity.domesticBankName || "",
    buyerBankAccount: entity.domesticBankAccount || "",
    blockingIssues: [...retainedIssues, ...domesticContractIssues(entity)],
  } satisfies SupplierTaxContractDraft;
}
