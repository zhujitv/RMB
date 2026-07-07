if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未配置，无法连接数据库修复物流费用成本关联。");
  process.exit(1);
}

const [{ repairLogisticsCostLinks }, { prisma }] = await Promise.all([
  import("../lib/platform/repair-logistics-cost-links.ts"),
  import("../lib/prisma.ts"),
]);

function parseList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasApplyFlag() {
  return process.argv.includes("--apply") || process.env.REPAIR_LOGISTICS_COST_LINKS_APPLY === "true";
}

function hasCreateMissingFlag() {
  return process.argv.includes("--create-missing") || process.env.REPAIR_LOGISTICS_COST_LINKS_CREATE_MISSING === "true";
}

try {
  const stats = await repairLogisticsCostLinks({
    orderNos: parseList(process.env.REPAIR_LOGISTICS_COST_LINKS_ORDER_NOS),
    orderIds: parseList(process.env.REPAIR_LOGISTICS_COST_LINKS_ORDER_IDS),
    logisticsFeeIds: parseList(process.env.REPAIR_LOGISTICS_COST_LINKS_FEE_IDS),
    limit: Number(process.env.REPAIR_LOGISTICS_COST_LINKS_LIMIT || 1000),
    dryRun: !hasApplyFlag(),
    createMissing: hasCreateMissingFlag(),
    source: "repair-script",
  });

  console.log(JSON.stringify({
    message: stats.dryRun ? "物流费用成本关联修复预检查完成，未写入数据库。" : "物流费用成本关联修复完成。",
    scanned: stats.scanned,
    repaired: stats.repaired,
    createdMissing: stats.createdMissing,
    syncedPayment: stats.syncedPayment,
    skipped: stats.skipped,
    dryRun: stats.dryRun,
    createMissing: stats.createMissing,
    issues: stats.issues,
    repairedLinks: stats.repairedLinks,
    createdMissingLinks: stats.createdMissingLinks,
    syncedPaymentLinks: stats.syncedPaymentLinks,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}

process.exit(0);
