export function includeOrderRelations() {
  return {
    customer: true,
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
      include: { uploadedBy: true, cost: { include: { supplier: true } }, supplier: true },
      orderBy: [{ documentType: "asc" as const }, { createdAt: "desc" as const }],
    },
    logisticsSuppliers: {
      include: { supplier: true, assignedBy: true },
      orderBy: [{ assignedAt: "desc" as const }],
    },
    shippingDocumentNotifications: {
      include: { sentBy: true },
      orderBy: [{ createdAt: "desc" as const }],
    },
    domesticLogisticsInfos: {
      where: { deletedAt: null },
      include: { submittedBy: true, financeConfirmedBy: true },
      orderBy: [{ updatedAt: "desc" as const }],
      take: 1,
    },
  };
}
