const TARGET_ORDER_NO = "DM22 23";
const TARGET_SUPPLIER_NAME = "安徽力华木塑科技有限公司";
const TARGET_COST_TYPE = "工厂货款";
const TARGET_AMOUNT_TEXT = "287627.85";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未配置，无法连接数据库清理重复成本。");
  process.exit(1);
}

const [{ PrismaPg }, { Prisma, PrismaClient }] = await Promise.all([
  import("@prisma/adapter-pg"),
  import("../lib/generated/prisma/client.js"),
]);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const TARGET_AMOUNT = new Prisma.Decimal(TARGET_AMOUNT_TEXT);

async function main() {
  const order = await prisma.receivableOrder.findFirst({
    where: { orderNo: TARGET_ORDER_NO, deletedAt: null },
    select: { id: true, orderNo: true },
  });
  if (!order) throw new Error(`未找到订单：${TARGET_ORDER_NO}`);

  const supplier = await prisma.supplier.findFirst({
    where: { supplierName: TARGET_SUPPLIER_NAME, deletedAt: null },
    select: { id: true, supplierName: true },
  });
  if (!supplier) throw new Error(`未找到供应商：${TARGET_SUPPLIER_NAME}`);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "receivable_orders"
      WHERE "id" = ${order.id}
      FOR UPDATE
    `);
    const currentOrder = await tx.receivableOrder.findUnique({
      where: { id: order.id },
      select: {
        deletedAt: true,
        taxArchived: true,
        taxRefundStatus: true,
        taxRefundArchivedAt: true,
        taxSubmittedAt: true,
        commissionStatus: true,
        commissionSettledAt: true,
        _count: {
          select: {
            commissionSettlementRecords: {
              where: { status: "ACTIVE", reversedAt: null },
            },
          },
        },
      },
    });
    if (!currentOrder || currentOrder.deletedAt) {
      throw new Error("订单不存在或已删除，重复成本清理已取消。");
    }
    const businessArchived = Boolean(
      currentOrder.taxArchived
      || currentOrder.taxRefundArchivedAt
      || currentOrder.taxSubmittedAt
      || ["SUBMITTED", "REFUND_RECEIVED", "COMPLETED", "ARCHIVED"].includes(String(currentOrder.taxRefundStatus || "")),
    );
    if (businessArchived) {
      throw new Error("订单已提交退税并归档，已阻止清理成本；请先在系统中取消归档。");
    }
    const commissionSettled = ["已结算", "SETTLED"].includes(String(currentOrder?.commissionStatus || ""))
      || Boolean(currentOrder?.commissionSettledAt)
      || Number(currentOrder?._count?.commissionSettlementRecords || 0) > 0;
    if (commissionSettled) {
      throw new Error("订单业务员提成已结算，已阻止清理成本；请先在系统中撤销提成结算。");
    }
    const costs = await tx.orderCost.findMany({
      where: {
        orderId: order.id,
        supplierId: supplier.id,
        costType: TARGET_COST_TYPE,
        amount: TARGET_AMOUNT,
        deletedAt: null,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, createdAt: true, amount: true },
    });
    if (costs.length <= 1) return { kept: costs[0] || null, duplicates: [] };
    const [kept, ...duplicates] = costs;
    const updated = await tx.orderCost.updateMany({
      where: {
        id: { in: duplicates.map((cost) => cost.id) },
        orderId: order.id,
        supplierId: supplier.id,
        costType: TARGET_COST_TYPE,
        amount: TARGET_AMOUNT,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });
    if (updated.count !== duplicates.length) {
      throw new Error("成本记录已变化，重复成本清理已取消。");
    }
    return { kept, duplicates };
  });

  if (!result.duplicates.length) {
    console.log(`无需清理：匹配成本 ${result.kept ? 1 : 0} 条。`);
    return;
  }
  console.log(`已保留成本 ${result.kept.id}，软删除重复成本 ${result.duplicates.map((cost) => cost.id).join(", ")}。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
