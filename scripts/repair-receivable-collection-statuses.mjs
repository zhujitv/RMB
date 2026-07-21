if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL 未配置，无法检查应收订单历史状态。");
  process.exit(1);
}

const [{ repairReceivableCollectionStatuses }, { prisma }] = await Promise.all([
  import("../lib/platform/repair-receivable-collection-statuses.ts"),
  import("../lib/prisma.ts"),
]);

function parseList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalInteger(value, name, minimum) {
  if (value == null || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} 必须是大于等于 ${minimum} 的整数。`);
  }
  return parsed;
}

const OUTPUT_PREVIEW_LIMIT = 20;
const PAYMENT_ID_PREVIEW_LIMIT = 10;

function compactPreview(items = []) {
  return items.slice(0, OUTPUT_PREVIEW_LIMIT).map((item) => {
    if (!Array.isArray(item?.paymentIds) || item.paymentIds.length <= PAYMENT_ID_PREVIEW_LIMIT) return item;
    return {
      ...item,
      paymentIds: item.paymentIds.slice(0, PAYMENT_ID_PREVIEW_LIMIT),
      paymentIdsOmitted: item.paymentIds.length - PAYMENT_ID_PREVIEW_LIMIT,
    };
  });
}

const apply = process.argv.includes("--apply")
  || process.env.REPAIR_RECEIVABLE_COLLECTION_STATUSES_APPLY === "true";

try {
  const legacyLimit = optionalInteger(
    process.env.REPAIR_RECEIVABLE_COLLECTION_LIMIT,
    "REPAIR_RECEIVABLE_COLLECTION_LIMIT",
    0,
  );
  const maxRows = optionalInteger(
    process.env.REPAIR_RECEIVABLE_COLLECTION_MAX_ROWS,
    "REPAIR_RECEIVABLE_COLLECTION_MAX_ROWS",
    0,
  ) ?? legacyLimit ?? 1000;
  const batchSize = optionalInteger(
    process.env.REPAIR_RECEIVABLE_COLLECTION_BATCH_SIZE,
    "REPAIR_RECEIVABLE_COLLECTION_BATCH_SIZE",
    1,
  ) ?? 200;
  const startAfterId = String(process.env.REPAIR_RECEIVABLE_COLLECTION_START_AFTER_ID || "").trim() || undefined;
  const result = await repairReceivableCollectionStatuses({
    orderNos: parseList(process.env.REPAIR_RECEIVABLE_COLLECTION_ORDER_NOS),
    orderIds: parseList(process.env.REPAIR_RECEIVABLE_COLLECTION_ORDER_IDS),
    startAfterId,
    maxRows,
    batchSize,
    dryRun: !apply,
    source: "repair-receivable-collection-statuses",
  });
  const outputTruncated = result.candidates.length > OUTPUT_PREVIEW_LIMIT
    || result.issues.length > OUTPUT_PREVIEW_LIMIT
    || result.repaired.length > OUTPUT_PREVIEW_LIMIT
    || result.concurrentlyChanged.length > OUTPUT_PREVIEW_LIMIT
    || [result.candidates, result.issues, result.repaired]
      .some((items) => items.some((item) => Array.isArray(item.paymentIds) && item.paymentIds.length > PAYMENT_ID_PREVIEW_LIMIT));
  console.log(JSON.stringify({
    message: `${result.dryRun
      ? "应收订单历史状态预检查完成，未写入数据库。"
      : "应收订单历史状态修复完成。"}${result.truncated
      ? ` 已达到 ${result.maxRows} 条总量上限，其余记录未扫描、未修改。`
      : ""}`,
    dryRun: result.dryRun,
    scanned: result.scanned,
    pagesScanned: result.pagesScanned,
    startAfterId: result.startAfterId,
    maxRows: result.maxRows,
    batchSize: result.batchSize,
    truncated: result.truncated,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
    candidateCount: result.candidateCount,
    issueCount: result.issueCount,
    repairedCount: result.repairedCount,
    concurrentlyChangedCount: result.concurrentlyChangedCount,
    candidates: compactPreview(result.candidates),
    issues: compactPreview(result.issues),
    repaired: compactPreview(result.repaired),
    concurrentlyChanged: result.concurrentlyChanged.slice(0, OUTPUT_PREVIEW_LIMIT),
    outputTruncated,
    outputPreviewLimit: OUTPUT_PREVIEW_LIMIT,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
