if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未配置，无法连接数据库修复供应商回传资料。");
  process.exit(1);
}

const [{ repairTaxRelations }, { prisma }] = await Promise.all([
  import("../lib/platform/repair-tax-relations.ts"),
  import("../lib/prisma.ts"),
]);

function parseList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

try {
  const stats = await repairTaxRelations({
    orderNos: parseList(process.env.REPAIR_TAX_RELATION_ORDER_NOS),
    orderIds: parseList(process.env.REPAIR_TAX_RELATION_ORDER_IDS),
    limit: Number(process.env.REPAIR_TAX_RELATION_LIMIT || 1000),
    dryRun: process.env.REPAIR_TAX_RELATION_DRY_RUN === "true",
    source: "repair-script",
  });

  console.log(JSON.stringify({
    message: "供应商回传资料关联修复完成",
    scanned: stats.scanned,
    repaired: stats.repaired,
    unable: stats.unable,
    refreshedOrders: stats.refreshedOrders,
    syncedCosts: stats.syncedCosts,
    issues: stats.issues,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
