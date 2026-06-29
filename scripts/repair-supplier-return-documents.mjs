if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未配置，无法连接数据库修复供应商回传资料。");
  process.exit(1);
}

const [{ PrismaPg }, { PrismaClient }, { refreshTaxRefundCompleteness, syncCostInvoiceStatus }] = await Promise.all([
  import("@prisma/adapter-pg"),
  import("../lib/generated/prisma/client.js"),
  import("../lib/platform/shared-tax-sync.ts"),
]);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const documents = await prisma.orderDocument.findMany({
    where: {
      factoryDocumentRequestId: { not: null },
      deletedAt: null,
    },
    include: {
      factoryDocumentRequest: {
        select: {
          id: true,
          orderId: true,
          supplierId: true,
          requiredDocumentTypes: true,
          order: { select: { orderNo: true } },
        },
      },
      supplier: { select: { id: true, supplierName: true } },
    },
    orderBy: [{ createdAt: "asc" }],
  });

  let repaired = 0;
  let skipped = 0;
  const affectedOrderIds = new Set();
  const affectedSupplierInvoicePairs = new Map();
  for (const document of documents) {
    const task = document.factoryDocumentRequest;
    if (!task?.orderId) {
      skipped += 1;
      console.warn("supplier-return-document-repair-skip", {
        documentId: document.id,
        factoryDocumentRequestId: document.factoryDocumentRequestId,
        reason: "missing task/orderId",
      });
      continue;
    }
    affectedOrderIds.add(task.orderId);
    if (document.documentType === "SUPPLIER_INVOICE" && task.supplierId) {
      affectedSupplierInvoicePairs.set(`${task.orderId}:${task.supplierId}`, {
        orderId: task.orderId,
        supplierId: task.supplierId,
      });
    }
    const data = {};
    if (document.orderId !== task.orderId) data.orderId = task.orderId;
    if ((document.supplierId || "") !== (task.supplierId || "")) data.supplierId = task.supplierId || null;
    if (document.relatedModule !== "SUPPLIER") data.relatedModule = "SUPPLIER";
    if (!Object.keys(data).length) {
      skipped += 1;
      continue;
    }
    await prisma.orderDocument.update({
      where: { id: document.id },
      data,
    });
    repaired += 1;
    console.info("supplier-return-document-repaired", {
      documentId: document.id,
      source: "SUPPLIER_RETURN",
      orderId: data.orderId || document.orderId,
      orderNo: task.order?.orderNo || "",
      supplierId: data.supplierId || document.supplierId || "",
      supplierName: document.supplier?.supplierName || "",
      documentType: document.documentType,
      factoryDocumentRequestId: task.id,
    });
  }

  let refreshedOrders = 0;
  for (const orderId of affectedOrderIds) {
    await refreshTaxRefundCompleteness(orderId);
    refreshedOrders += 1;
  }

  let syncedCosts = 0;
  for (const pair of affectedSupplierInvoicePairs.values()) {
    const costs = await prisma.orderCost.findMany({
      where: {
        orderId: pair.orderId,
        supplierId: pair.supplierId,
        deletedAt: null,
      },
      select: { id: true },
    });
    for (const cost of costs) {
      await syncCostInvoiceStatus(cost.id);
      syncedCosts += 1;
    }
  }

  console.log(`供应商回传资料修复完成：已修复 ${repaired} 条，跳过 ${skipped} 条，刷新订单完整度 ${refreshedOrders} 个，同步成本发票状态 ${syncedCosts} 条。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
