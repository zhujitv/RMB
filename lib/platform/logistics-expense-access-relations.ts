import { Prisma } from "../generated/prisma/client.js";
import { includeCostRelations } from "./cost-records-shared";

export function includeLogisticsExpenseRelations() {
  return Prisma.validator<Prisma.LogisticsExpenseInclude>()({
    bill: {
      include: {
        submittedBy: true,
        reviewedBy: true,
        voidedBy: true,
        createdBy: true,
        updatedBy: true,
      },
    },
    order: {
      include: {
        customer: true,
        businessEntity: true,
        salesperson: true,
        logisticsSuppliers: { include: { supplier: true } },
        domesticLogisticsInfos: {
          include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
      },
    },
    supplier: { include: { operatorUsers: true } },
    cost: { include: includeCostRelations() },
    createdBy: true,
    updatedBy: true,
    reviewedBy: true,
    invoiceDocument: { include: { uploadedBy: true, supplier: true, cost: true } },
    invoiceUploadedBy: true,
    invoiceConfirmedBy: true,
  });
}

export function includeLogisticsExpenseListRelations() {
  return Prisma.validator<Prisma.LogisticsExpenseInclude>()({
    bill: {
      include: {
        submittedBy: true,
        reviewedBy: true,
        voidedBy: true,
        createdBy: true,
        updatedBy: true,
      },
    },
    order: {
      include: {
        customer: true,
        businessEntity: true,
        salesperson: true,
        domesticLogisticsInfos: {
          include: { transportItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
      },
    },
    supplier: true,
    createdBy: true,
    updatedBy: true,
    reviewedBy: true,
    invoiceDocument: { include: { uploadedBy: true, supplier: true } },
    invoiceUploadedBy: true,
    invoiceConfirmedBy: true,
  });
}
