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

  const costs = await prisma.orderCost.findMany({
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

  if (costs.length <= 1) {
    console.log(`无需清理：匹配成本 ${costs.length} 条。`);
    return;
  }

  const [kept, ...duplicates] = costs;
  await prisma.$transaction(
    duplicates.map((cost) => (
      prisma.orderCost.update({
        where: { id: cost.id },
        data: { deletedAt: new Date() },
      })
    )),
  );

  console.log(`已保留成本 ${kept.id}，软删除重复成本 ${duplicates.map((cost) => cost.id).join(", ")}。`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
