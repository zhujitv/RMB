if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未配置，无法连接数据库刷新退税资料完整度。");
  process.exit(1);
}

const [{ prisma }, { refreshTaxRefundCompleteness }] = await Promise.all([
  import("../lib/prisma.ts"),
  import("../lib/platform/shared-tax-sync.ts"),
]);

async function main() {
  const orders = await prisma.receivableOrder.findMany({
    where: { deletedAt: null },
    select: { id: true, orderNo: true },
    orderBy: [{ createdAt: "asc" }],
  });

  let refreshed = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      await refreshTaxRefundCompleteness(order.id);
      refreshed += 1;
    } catch (error) {
      failed += 1;
      console.error("tax-refund-completeness-refresh-failed", {
        orderId: order.id,
        orderNo: order.orderNo,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`退税资料完整度刷新完成：已刷新 ${refreshed} 个订单，失败 ${failed} 个。`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
