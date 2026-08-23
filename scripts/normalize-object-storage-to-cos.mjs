import { createHash } from "node:crypto";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

const apply = process.argv.includes("--apply") || process.env.NORMALIZE_STORAGE_TO_COS_APPLY === "true";
const concurrency = Math.min(12, Math.max(1, Number(process.env.NORMALIZE_STORAGE_TO_COS_CONCURRENCY || 8)));

const [{ prisma }, { objectStorageConfig }] = await Promise.all([
  import("../lib/prisma.ts"),
  import("../lib/object-storage-config.ts"),
]);

const storage = objectStorageConfig();
const client = new S3Client({
  region: storage.region,
  endpoint: storage.endpoint,
  forcePathStyle: false,
  credentials: {
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
  },
});

function keyFingerprint(key) {
  return createHash("sha256").update(String(key || "")).digest("hex").slice(0, 12);
}

async function loadLegacyReferences() {
  const [documents, assets, templates, vouchers] = await Promise.all([
    prisma.orderDocument.findMany({
      where: {
        storageKey: { not: "" },
        OR: [{ r2Bucket: { not: storage.bucket } }],
      },
      select: { storageKey: true, deletedAt: true },
    }),
    prisma.fileAsset.findMany({
      where: {
        storageKey: { not: "" },
        OR: [{ bucket: null }, { bucket: { not: storage.bucket } }],
      },
      select: { storageKey: true, isDeleted: true, deletedAt: true },
    }),
    prisma.supplierDocumentRequest.findMany({
      where: {
        templateStorageKey: { not: null },
        OR: [{ templateBucket: null }, { templateBucket: { not: storage.bucket } }],
      },
      select: { templateStorageKey: true, deletedAt: true },
    }),
    prisma.orderCost.findMany({
      where: {
        paymentVoucherStorageKey: { not: null },
        OR: [{ paymentVoucherBucket: null }, { paymentVoucherBucket: { not: storage.bucket } }],
      },
      select: { paymentVoucherStorageKey: true, deletedAt: true },
    }),
  ]);
  const references = [
    ...documents.map((row) => ({ key: row.storageKey, active: !row.deletedAt })),
    ...assets.map((row) => ({ key: row.storageKey, active: !row.isDeleted && !row.deletedAt })),
    ...templates.map((row) => ({ key: row.templateStorageKey || "", active: !row.deletedAt })),
    ...vouchers.map((row) => ({ key: row.paymentVoucherStorageKey || "", active: !row.deletedAt })),
  ].filter((row) => row.key);
  const keys = [...new Set(references.map((row) => row.key))];
  const activeKeys = [...new Set(references.filter((row) => row.active).map((row) => row.key))];
  return {
    counts: {
      orderDocuments: documents.length,
      fileAssets: assets.length,
      supplierTemplates: templates.length,
      paymentVouchers: vouchers.length,
      uniqueObjects: keys.length,
      verifiedActiveObjects: activeKeys.length,
      inactiveOnlyObjects: keys.length - activeKeys.length,
    },
    keys,
    activeKeys,
  };
}

async function verifyObjects(keys) {
  const failures = [];
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const key = keys[next++];
      try {
        await client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));
      } catch (error) {
        failures.push({
          keyFingerprint: keyFingerprint(key),
          code: String(error?.name || error?.Code || "UNKNOWN"),
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length || 1) }, worker));
  return failures;
}

async function normalizeRecords() {
  return prisma.$transaction(async (tx) => {
    const [orderDocuments, fileAssets, supplierTemplates, paymentVouchers] = await Promise.all([
      tx.orderDocument.updateMany({
        where: { storageKey: { not: "" }, r2Bucket: { not: storage.bucket } },
        data: { r2Bucket: storage.bucket },
      }),
      tx.fileAsset.updateMany({
        where: { storageKey: { not: "" }, OR: [{ bucket: null }, { bucket: { not: storage.bucket } }] },
        data: { bucket: storage.bucket },
      }),
      tx.supplierDocumentRequest.updateMany({
        where: {
          templateStorageKey: { not: null },
          OR: [{ templateBucket: null }, { templateBucket: { not: storage.bucket } }],
        },
        data: { templateBucket: storage.bucket },
      }),
      tx.orderCost.updateMany({
        where: {
          paymentVoucherStorageKey: { not: null },
          OR: [{ paymentVoucherBucket: null }, { paymentVoucherBucket: { not: storage.bucket } }],
        },
        data: { paymentVoucherBucket: storage.bucket },
      }),
    ]);
    return {
      orderDocuments: orderDocuments.count,
      fileAssets: fileAssets.count,
      supplierTemplates: supplierTemplates.count,
      paymentVouchers: paymentVouchers.count,
    };
  });
}

try {
  const before = await loadLegacyReferences();
  const failures = await verifyObjects(before.activeKeys);
  if (failures.length) {
    console.error(JSON.stringify({
      status: "blocked",
      reason: "COS_OBJECT_VERIFICATION_FAILED",
      counts: before.counts,
      failures: failures.slice(0, 20),
    }));
    process.exitCode = 1;
  } else if (!apply) {
    console.log(JSON.stringify({ status: "dry-run", verified: before.counts }));
  } else {
    const updated = await normalizeRecords();
    const after = await loadLegacyReferences();
    if (after.keys.length) throw new Error("仍存在未统一到 COS 的存储记录，事务结果校验失败。");
    console.log(JSON.stringify({ status: "applied", verified: before.counts, updated, remainingLegacyRecords: 0 }));
  }
} finally {
  client.destroy();
  await prisma.$disconnect();
}
