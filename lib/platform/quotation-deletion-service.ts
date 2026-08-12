import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import { lockQuotationForEmailMutation } from "./quotation-email-delivery-claim";
import { enqueueFileStorageDeletion } from "./file-storage-deletion-outbox";
import { assertExpectedQuotationVersion } from "./quotation-calculations";
import { loadQuotation } from "./quotation-query-service";
import {
  quotationText,
  type QuotationActor,
} from "./quotation-values";

type AuditRequest = Parameters<typeof writeAudit>[0];

const QUOTATION_VERSION_SOURCE_TABLE = "sales_quotation_versions";

function requireAdministrator(actor: QuotationActor) {
  const actorId = String(actor?.id || "").trim();
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以永久删除报价草稿", 403, "QUOTATION_DELETE_ADMIN_ONLY");
  }
  return actorId;
}

export async function deleteQuotationDraft(
  request: AuditRequest,
  actor: QuotationActor,
  id: string,
  input: unknown,
) {
  assertWrite(actor, "quotations");
  const actorId = requireAdministrator(actor);
  const body = assertJsonObject(input);
  const reason = quotationText(body.reason, "删除原因", 500, true);
  const confirmQuoteNo = quotationText(body.confirmQuoteNo, "确认报价号", 100, true);

  const deleted = await prisma.$transaction(async (tx) => {
    await lockQuotationForEmailMutation(tx, id);
    const before = await loadQuotation(id, actor, tx);
    await assertCustomerScope(actor, before.customerId, tx);
    assertExpectedQuotationVersion(body, before.currentVersionNumber);
    if (confirmQuoteNo !== before.quoteNo) {
      throw codedError("确认报价号不一致，请重新输入", 400, "QUOTATION_DELETE_CONFIRMATION_MISMATCH");
    }
    if (before.status !== "DRAFT") {
      throw codedError(
        "只有未发送的报价草稿可以永久删除，其他报价请使用作废",
        409,
        "QUOTATION_DELETE_STATUS_LOCKED",
      );
    }
    if (before.deliveries.length) {
      throw codedError(
        "该报价已有邮件发送记录，不能永久删除，请使用作废",
        409,
        "QUOTATION_DELETE_DELIVERY_LOCKED",
      );
    }

    const versionIds = before.versions.map((version) => version.id);
    const [quotationEmailOutboxCount, quotationDeliveryLogCount] = versionIds.length
      ? await Promise.all([
          tx.notificationOutbox.count({
            where: {
              type: "QUOTATION_CUSTOMER_EMAIL",
              relatedEntityType: QUOTATION_VERSION_SOURCE_TABLE,
              relatedEntityId: { in: versionIds },
            },
          }),
          tx.notificationDeliveryLog.count({
            where: {
              type: "QUOTATION_CUSTOMER_EMAIL",
              relatedEntityType: QUOTATION_VERSION_SOURCE_TABLE,
              relatedEntityId: { in: versionIds },
            },
          }),
        ])
      : [0, 0];
    if (quotationEmailOutboxCount || quotationDeliveryLogCount) {
      throw codedError(
        "该报价已有邮件流转记录，不能永久删除，请使用作废",
        409,
        "QUOTATION_DELETE_EMAIL_HISTORY_LOCKED",
      );
    }
    const fileAssets = versionIds.length
      ? await tx.fileAsset.findMany({
          where: {
            sourceTable: QUOTATION_VERSION_SOURCE_TABLE,
            sourceId: { in: versionIds },
          },
          select: { id: true, bucket: true, sourceId: true, fileRole: true, storageKey: true },
        })
      : [];

    for (const asset of fileAssets) {
      const expectedPrefix = `sales-quotations/${before.id}/versions/${asset.sourceId}/`;
      if (!asset.storageKey.startsWith(expectedPrefix)) {
        throw codedError(
          "报价文件路径校验失败，已停止删除，请联系管理员检查文件记录",
          409,
          "QUOTATION_DOCUMENT_DELETE_PATH_INVALID",
        );
      }
    }

    const currentVersion = before.versions.find(
      (version) => version.versionNumber === before.currentVersionNumber,
    );
    await writeAudit(
      request,
      { id: actorId },
      "永久删除报价草稿",
      "sales_quotations",
      before.id,
      {
        id: before.id,
        quoteNo: before.quoteNo,
        invoiceNo: before.invoiceNo,
        customerId: before.customerId,
        status: before.status,
        currentVersionNumber: before.currentVersionNumber,
        totalAmount: currentVersion?.totalAmount?.toString() || "0",
      },
      { deleted: true, reason, versionCount: versionIds.length, documentCount: fileAssets.length },
      tx,
    );

    const deletionTaskIds: string[] = [];
    for (const asset of fileAssets) {
      const task = await enqueueFileStorageDeletion(tx, {
        bucket: asset.bucket,
        storageKey: asset.storageKey,
        sourceTable: QUOTATION_VERSION_SOURCE_TABLE,
        sourceId: asset.sourceId,
        fileRole: asset.fileRole,
        deleteAfter: new Date(),
      });
      if (task?.id) deletionTaskIds.push(task.id);
    }

    await tx.$queryRaw`SELECT set_config('app.quotation_hard_delete_id', ${before.id}, true)`;
    await tx.salesQuotationDelivery.deleteMany({ where: { quotationId: before.id } });
    if (versionIds.length) {
      await tx.fileAsset.deleteMany({
        where: {
          sourceTable: QUOTATION_VERSION_SOURCE_TABLE,
          sourceId: { in: versionIds },
        },
      });
      await tx.salesQuotationItem.deleteMany({ where: { quotationVersionId: { in: versionIds } } });
      await tx.salesQuotationVersion.deleteMany({ where: { id: { in: versionIds }, quotationId: before.id } });
    }
    const deleted = await tx.salesQuotation.deleteMany({
      where: {
        id: before.id,
        status: "DRAFT",
        currentVersionNumber: before.currentVersionNumber,
      },
    });
    if (deleted.count !== 1) {
      throw codedError("报价已被其他用户更新，请刷新后重试", 409, "QUOTATION_DELETE_CONFLICT");
    }

    return {
      id: before.id,
      quoteNo: before.quoteNo,
      deletedVersionCount: versionIds.length,
      deletedDocumentCount: fileAssets.length,
      deletionTaskIds,
    };
  }, { maxWait: 10_000, timeout: 60_000 });

  return {
    id: deleted.id,
    quoteNo: deleted.quoteNo,
    action: "deleted" as const,
    deletedVersionCount: deleted.deletedVersionCount,
    deletedDocumentCount: deleted.deletedDocumentCount,
    cleanupPending: deleted.deletionTaskIds.length > 0,
  };
}
