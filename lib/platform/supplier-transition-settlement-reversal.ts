import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError, nonEmpty } from "./shared-base-utils";
import { writeAudit } from "./shared-audit";
import {
  FILE_ASSET_ROLES,
  FILE_ASSET_SOURCE_TABLES,
  runNonCriticalTask,
  scheduleTaxRefundCompletenessRefresh,
  softDeleteFileAssetBySource,
} from "./shared";
import {
  supplierDocumentRequestInclude,
  type ActorLike,
  type AuditRequestLike,
} from "./supplier-document-request-types";
import {
  actorId,
  serializeSupplierDocumentRequest,
  supplierDocumentRequestOrderLocked,
} from "./supplier-document-request-serialization";
import { FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE } from "./factory-purchase-transition-settlement-values";

function requireAdmin(actor: ActorLike) {
  if (actor?.role !== "管理员") {
    throw codedError("只有管理员可以撤销过渡结算凭证。", 403, "FACTORY_TRANSITION_REVOKE_ADMIN_ONLY");
  }
  assertWrite(actor, "supplierDocuments");
  return actorId(actor);
}

function transitionSettlementIdFromDraft(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const draft = value as Record<string, unknown>;
  if (draft.sourceType !== FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE) return "";
  return nonEmpty(draft.transitionSettlementId);
}

export async function revokeSupplierDocumentTransitionSettlement(
  request: AuditRequestLike,
  actor: ActorLike,
  requestId: string,
  input: Record<string, unknown>,
) {
  const revokedById = requireAdmin(actor);
  const reason = nonEmpty(input.reason).slice(0, 1000);
  if (reason.length < 5) {
    throw codedError("请填写至少5个字的撤销原因。", 400, "FACTORY_TRANSITION_REVOKE_REASON_REQUIRED");
  }

  const row = await prisma.supplierDocumentRequest.findFirst({
    where: { id: requestId, deletedAt: null },
    include: {
      ...supplierDocumentRequestInclude(),
      cost: {
        include: {
          transitionSettlements: {
            where: { revokedAt: null },
            orderBy: { confirmedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!row) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
  if (supplierDocumentRequestOrderLocked(row.order)) {
    throw codedError("该订单已提交退税或归档，不能撤销过渡结算。", 409, "FACTORY_TRANSITION_REVOKE_TAX_LOCKED");
  }
  if (row.invoiceConfirmedAt || row.invoiceMatchStatus === "CONFIRMED") {
    throw codedError("供应商发票已人工确认，不能撤销过渡结算。", 409, "FACTORY_TRANSITION_REVOKE_INVOICE_CONFIRMED");
  }

  const draftTransitionId = transitionSettlementIdFromDraft(row.contractDraft)
    || transitionSettlementIdFromDraft(row.contractApproved);
  const costTransitionId = row.cost?.sourceType === FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE
    ? nonEmpty(row.cost.sourceId)
    : "";
  const relationTransitionId = row.cost?.transitionSettlements?.[0]?.id || "";
  const transitionSettlementId = draftTransitionId || costTransitionId || relationTransitionId;
  if (!row.costId || !row.cost || !transitionSettlementId) {
    throw codedError("当前任务没有可撤销的过渡结算凭证。", 409, "FACTORY_TRANSITION_REVOKE_NOT_TRANSITION");
  }
  if (
    row.cost.sourceType !== FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE
    || row.cost.sourceId !== transitionSettlementId
  ) {
    throw codedError("成本来源已变化，请刷新后重试。", 409, "FACTORY_TRANSITION_REVOKE_COST_CHANGED");
  }

  const now = new Date();
  const activeDocuments = (row.documents || []).filter((document) => !document.deletedAt);
  const activeDocumentIds = activeDocuments.map((document) => document.id);

  const updated = await prisma.$transaction(async (tx) => {
    const settlementUpdate = await tx.factoryPurchaseTransitionSettlement.updateMany({
      where: { id: transitionSettlementId, costId: row.costId!, revokedAt: null },
      data: {
        revokedAt: now,
        revokedById,
        revocationReason: reason,
      },
    });
    if (settlementUpdate.count !== 1) {
      throw codedError("过渡结算凭证已变化，请刷新后重试。", 409, "FACTORY_TRANSITION_REVOKE_SETTLEMENT_CONFLICT");
    }

    const costUpdate = await tx.orderCost.updateMany({
      where: {
        id: row.costId!,
        sourceType: FACTORY_PURCHASE_TRANSITION_SETTLEMENT_SOURCE_TYPE,
        sourceId: transitionSettlementId,
        deletedAt: null,
        status: "ACTIVE",
      },
      data: {
        sourceType: "MANUAL",
        sourceId: null,
        remark: `过渡结算撤销：${reason}`.slice(0, 1000),
        updatedById: revokedById,
      },
    });
    if (costUpdate.count !== 1) {
      throw codedError("成本状态已变化，请刷新后重试。", 409, "FACTORY_TRANSITION_REVOKE_COST_CONFLICT");
    }

    if (activeDocumentIds.length) {
      await tx.orderDocument.updateMany({
        where: { id: { in: activeDocumentIds }, deletedAt: null },
        data: { deletedAt: now },
      });
      for (const documentId of activeDocumentIds) {
        await softDeleteFileAssetBySource(
          tx,
          FILE_ASSET_SOURCE_TABLES.ORDER_DOCUMENTS,
          documentId,
          String(activeDocuments.find((document) => document.id === documentId)?.documentType || "ORDER_DOCUMENT"),
          now,
        );
      }
    }

    if (row.templateStorageKey) {
      await softDeleteFileAssetBySource(
        tx,
        FILE_ASSET_SOURCE_TABLES.SUPPLIER_DOCUMENT_REQUESTS,
        row.id,
        FILE_ASSET_ROLES.SUPPLIER_REQUEST_TEMPLATE,
        now,
      );
    }

    await tx.supplierDocumentRequest.update({
      where: { id: row.id },
      data: {
        costId: null,
        status: "已关闭",
        completedAt: null,
        completedById: null,
        contractNo: null,
        contractStatus: "LEGACY",
        contractDraft: Prisma.JsonNull,
        contractApproved: Prisma.JsonNull,
        contractReviewedById: null,
        contractReviewedAt: null,
        contractReviewRemark: `过渡结算已撤销：${reason}`.slice(0, 1000),
        invoiceMatchStatus: "NOT_UPLOADED",
        invoiceMatchJson: Prisma.JsonNull,
        invoiceNo: null,
        invoiceOcrTaskId: null,
        invoiceConfirmedById: null,
        invoiceConfirmedAt: null,
        invoiceRejectReason: null,
        templateFileName: null,
        templateOriginalName: null,
        templateMimeType: null,
        templateFileSize: null,
        templateStorageKey: null,
        templateBucket: null,
        sendStatus: "transition_revoked",
        sendError: "过渡结算已撤销，可重新创建资料回传任务。",
        message: `过渡结算已撤销：${reason}`.slice(0, 1000),
      },
    });

    const saved = await tx.supplierDocumentRequest.findUnique({
      where: { id: row.id },
      include: supplierDocumentRequestInclude(),
    });
    if (!saved) throw codedError("资料回传任务不存在。", 404, "SUPPLIER_DOCUMENT_REQUEST_NOT_FOUND");
    return saved;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10000,
    timeout: 15000,
  });

  scheduleTaxRefundCompletenessRefresh(row.orderId, "过渡结算撤销后退税完整度刷新");
  await runNonCriticalTask("撤销过渡结算审计", () => writeAudit(
    request,
    actor,
    "撤销历史过渡结算",
    "factory_purchase_transition_settlements",
    transitionSettlementId,
    row,
    {
      requestId: row.id,
      costId: row.costId,
      orderNo: row.order?.orderNo,
      supplierId: row.supplierId,
      reason,
      deletedDocumentIds: activeDocumentIds,
    },
  ));

  return serializeSupplierDocumentRequest(updated, actor);
}
