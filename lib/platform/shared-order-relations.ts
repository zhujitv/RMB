import { Prisma } from "../generated/prisma/client.js";

export function domesticLogisticsInfoSafeSelect() {
  return Prisma.validator<Prisma.DomesticLogisticsInfoSelect>()({
    id: true,
    orderId: true,
    transportType: true,
    truckPlateNo: true,
    trailerPlateNo: true,
    departurePlace: true,
    destinationPlace: true,
    departureDate: true,
    expressTrackingNo: true,
    cargoDescription: true,
    remarkTextManualEdited: true,
    remarkText: true,
    exportInvoice: true,
    submittedByUserId: true,
    submittedAt: true,
    submitterRole: true,
    financeStatus: true,
    financeConfirmedById: true,
    financeConfirmedAt: true,
    rejectReason: true,
    correctionRequested: true,
    correctionReason: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
    submittedBy: true,
    financeConfirmedBy: true,
    transportItems: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
  });
}

export function includeOrderRelations() {
  return Prisma.validator<Prisma.ReceivableOrderInclude>()({
    customer: true,
    businessEntity: true,
    salesperson: true,
    commissionSettledBy: true,
    taxRefundArchivedBy: true,
    taxSubmittedBy: true,
    createdBy: true,
    updatedBy: true,
    payments: {
      where: { deletedAt: null },
      include: { createdBy: true, updatedBy: true },
      orderBy: [{ paymentDate: "desc" as const }, { createdAt: "desc" as const }],
    },
    costs: {
      where: { deletedAt: null },
      include: {
        supplier: true,
        createdBy: true,
        updatedBy: true,
        generatedLogisticsExpense: {
          select: {
            customsDeclarationId: true,
            allocationMethod: true,
            allocatedAmount: true,
            invoiceDocument: {
              include: {
                uploadedBy: true,
                cost: { include: { supplier: true } },
                supplier: true,
                logisticsExpenseInvoices: {
                  where: { deletedAt: null },
                  include: { bill: true, cost: true, supplier: true },
                },
              },
            },
          },
        },
        documents: {
          where: { deletedAt: null },
          include: { uploadedBy: true, supplier: true },
          orderBy: [{ documentType: "asc" as const }, { createdAt: "desc" as const }],
        },
      },
      orderBy: [{ createdAt: "desc" as const }],
    },
    documents: {
      where: { deletedAt: null },
      include: {
        uploadedBy: true,
        cost: { include: { supplier: true } },
        supplier: true,
        logisticsExpenseInvoices: {
          where: { deletedAt: null },
          include: { bill: true, cost: true, supplier: true },
        },
      },
      orderBy: [{ documentType: "asc" as const }, { createdAt: "desc" as const }],
    },
    logisticsSuppliers: {
      include: { supplier: true, assignedBy: true },
      orderBy: [{ assignedAt: "desc" as const }],
    },
    customsDeclarations: {
      where: { deletedAt: null },
      select: {
        id: true,
        supplierId: true,
        purchaseOrderId: true,
        declarationAmount: true,
        containerCount: true,
        suppliers: {
          where: { deletedAt: null },
          select: { supplierId: true, purchaseOrderId: true, requiredInvoiceAmount: true, vatInvoiceAmount: true, contractAmount: true, splitAmount: true },
          take: 200,
        },
      },
      orderBy: [{ declarationDate: "asc" as const }, { createdAt: "asc" as const }],
      take: 100,
    },
    shippingDocumentNotifications: {
      include: { sentBy: true },
      orderBy: [{ createdAt: "desc" as const }],
    },
    domesticLogisticsInfos: {
      where: { deletedAt: null },
      select: domesticLogisticsInfoSafeSelect(),
      orderBy: [{ updatedAt: "desc" as const }],
      take: 1,
    },
  });
}
