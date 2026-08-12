import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertExpectedQuotationVersion } from "./quotation-calculations";
import {
  assertNoActiveQuotationEmailLease,
  lockQuotationForEmailMutation,
} from "./quotation-email-delivery-claim";
import { assertQuotationVersionNotExpired } from "./quotation-email-delivery-rules";
import { loadQuotation } from "./quotation-query-service";
import {
  quotationManualConfirmationChannel,
  quotationText,
  requiredQuotationConfirmationDate,
  serializeQuotation,
  type QuotationActor,
} from "./quotation-values";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";

type AuditRequest = Parameters<typeof writeAudit>[0];

function actorId(actor: QuotationActor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

function sameDate(left: Date, right: Date) {
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

export async function recordManualQuotationConfirmation(
  request: AuditRequest,
  actor: QuotationActor,
  quotationId: string,
  input: unknown,
) {
  assertWrite(actor, "quotations");
  const userId = actorId(actor);
  const body = assertJsonObject(input);
  const channel = quotationManualConfirmationChannel(body.channel);
  const note = quotationText(body.note, "确认备注", 1000) || null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockQuotationForEmailMutation(tx, quotationId);
        const before = await loadQuotation(quotationId, actor, tx);
        await assertCustomerScope(actor, before.customerId, tx);
        assertExpectedQuotationVersion(body, before.currentVersionNumber);
        const currentVersion = before.versions.find(
          (version) => version.versionNumber === before.currentVersionNumber,
        );
        if (!currentVersion) {
          throw codedError("报价当前版本不存在", 500, "QUOTATION_VERSION_MISSING");
        }
        if (!currentVersion.sealedAt) {
          throw codedError("报价当前版本尚未封存", 409, "QUOTATION_VERSION_NOT_SEALED");
        }
        const confirmationDate = requiredQuotationConfirmationDate(
          body.confirmationDate,
          currentVersion.quoteDate,
        );
        const existingDecision = before.decisions.find(
          (decision) => decision.quotationVersionId === currentVersion.id,
        );
        if (existingDecision) {
          const sameManualConfirmation = existingDecision.decision === "ACCEPTED"
            && existingDecision.channel !== "SYSTEM_EMAIL"
            && existingDecision.channel === channel
            && sameDate(existingDecision.respondedAt, confirmationDate)
            && (existingDecision.note || null) === note;
          if (before.status === "ACCEPTED" && sameManualConfirmation) {
            return serializeQuotation(before, true);
          }
          throw codedError(
            "当前报价版本已有客户决策记录",
            409,
            "QUOTATION_DECISION_CONFLICT",
          );
        }
        if (!(before.status === "DRAFT" || before.status === "SENT")) {
          throw codedError(
            "只有草稿或已发送报价可以手动登记客户确认",
            409,
            "QUOTATION_MANUAL_CONFIRMATION_NOT_ALLOWED",
          );
        }
        assertQuotationVersionNotExpired(currentVersion.validUntil);
        await assertNoActiveQuotationEmailLease(tx, before.id, currentVersion.id);
        const changed = await tx.salesQuotation.updateMany({
          where: {
            id: before.id,
            status: { in: ["DRAFT", "SENT"] },
            currentVersionNumber: before.currentVersionNumber,
          },
          data: { status: "ACCEPTED", updatedById: userId },
        });
        if (changed.count !== 1) {
          throw codedError("报价状态已变化，请刷新后重试", 409, "QUOTATION_STATUS_CONFLICT");
        }
        await tx.salesQuotationDecision.create({
          data: {
            quotationId: before.id,
            quotationVersionId: currentVersion.id,
            channel,
            decision: "ACCEPTED",
            respondedAt: confirmationDate,
            note,
            recordedById: userId,
          },
        });
        const saved = await loadQuotation(before.id, actor, tx);
        await writeAudit(
          request,
          { id: userId },
          "手动登记客户接受报价",
          "sales_quotations",
          before.id,
          serializeQuotation(before, true),
          serializeQuotation(saved, true),
          tx,
        );
        return serializeQuotation(saved, true);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: unknown) {
      const code = String((error as { code?: string } | null)?.code || "");
      if (["P2002", "P2034"].includes(code) && attempt < 2) continue;
      if (["P2002", "P2034"].includes(code)) {
        throw codedError("报价确认发生并发冲突，请刷新后重试", 409, "QUOTATION_CONFIRMATION_CONFLICT");
      }
      throw error;
    }
  }
  throw codedError("报价确认发生并发冲突，请刷新后重试", 409, "QUOTATION_CONFIRMATION_CONFLICT");
}
