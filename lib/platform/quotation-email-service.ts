import { prisma } from "../prisma";
import { ensureQuotationDocument, readQuotationDocument } from "./quotation-documents";
import {
  claimQuotationEmailDelivery,
  finalizeQuotationEmailDelivery,
} from "./quotation-email-delivery-claim";
import {
  findSentQuotationEmailOutbox as findSentOutbox,
  markQuotationEmailDeliveryFailed,
  persistedQuotationEmailDraft as persistedDeliveryDraft,
} from "./quotation-email-delivery-state";
import {
  assertQuotationEmailRecipientLimits,
  assertQuotationVersionNotExpired,
  type QuotationEmailDeliveryPayload,
} from "./quotation-email-delivery-rules";
import { assertQuotationCustomerEmailRecipients } from "./quotation-email-recipients";
import {
  buildQuotationEmailDefaultDraft,
  normalizeQuotationEmailRequestKey,
  normalizeQuotationEmailSendInput,
  quotationEmailTemplateVariables,
} from "./quotation-email-values";
import { serializeQuotationDelivery } from "./quotation-delivery-values";
import { applyTemplate, definitionByType } from "./notification-helpers";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { sendNotificationEmail } from "./notification-send";
import { loadQuotation } from "./quotation-query-service";
import { assertRead, assertWrite, codedError, logServerError, writeAudit } from "./shared";
import { type QuotationActor } from "./quotation-values";

type AuditRequest = Parameters<typeof writeAudit>[0];

async function markDeliveryFailed(deliveryId: string, idempotencyKey: string, error: unknown) {
  const result = await markQuotationEmailDeliveryFailed(deliveryId, idempotencyKey, error);
  return result.sent ? result : { ...result, status: "FAILED" as const };
}

function requireActorId(actor: QuotationActor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

function quotationVersion(
  quotation: Awaited<ReturnType<typeof loadQuotation>>,
  requested: unknown = null,
  currentOnly = true,
) {
  const versionNumber = requested === null || requested === undefined || requested === ""
    ? quotation.currentVersionNumber
    : Number(requested);
  if (!Number.isSafeInteger(versionNumber) || (currentOnly && versionNumber !== quotation.currentVersionNumber)) {
    throw codedError("只能发送报价的当前版本", 409, "QUOTATION_CURRENT_VERSION_REQUIRED");
  }
  const version = quotation.versions.find((item) => item.versionNumber === versionNumber);
  if (!version) throw codedError("报价当前版本不存在", 500, "QUOTATION_VERSION_MISSING");
  return version;
}

function draftSource(quotation: Awaited<ReturnType<typeof loadQuotation>>, version: ReturnType<typeof quotationVersion>) {
  return {
    quoteNo: quotation.quoteNo,
    customerNameSnapshot: version.customerNameSnapshot,
    contactEmailSnapshot: version.contactEmailSnapshot,
    versionNumber: version.versionNumber,
    totalAmount: version.totalAmount.toFixed(2),
    currency: version.currency,
    salespersonName: quotation.salesperson?.name || "NEXTWOOD Sales Team",
    sellerName: version.sellerNameEnSnapshot || version.businessEntityNameSnapshot || "NEXTWOOD",
  };
}

async function buildQuotationEmailDraft(
  quotation: Awaited<ReturnType<typeof loadQuotation>>,
  version: ReturnType<typeof quotationVersion>,
) {
  const source = draftSource(quotation, version);
  const invoiceNo = version.invoiceNoSnapshot || quotation.quoteNo;
  const base = buildQuotationEmailDefaultDraft(source);
  const variables = quotationEmailTemplateVariables(source);
  const storedTemplate = await prisma.notificationTemplate.findUnique({
    where: { type: NOTIFICATION_TYPES.QUOTATION_CUSTOMER_EMAIL },
  });
  const template = storedTemplate || definitionByType(NOTIFICATION_TYPES.QUOTATION_CUSTOMER_EMAIL);
  if (!template) throw codedError("报价邮件模板不存在", 500, "QUOTATION_EMAIL_TEMPLATE_MISSING");
  return {
    ...base,
    subject: applyTemplate(template.subjectTemplate, variables),
    body: applyTemplate(template.bodyTemplate, variables),
    templateEnabled: "enabled" in template ? template.enabled : template.defaultEnabled ?? true,
    quoteNo: quotation.quoteNo,
    versionNumber: version.versionNumber,
    attachmentFileName: `Proforma-Invoice-${invoiceNo}-V${version.versionNumber}.pdf`,
    deliveries: quotation.deliveries
      .filter((delivery) => delivery.quotationVersionId === version.id)
      .map(serializeQuotationDelivery),
  };
}

export async function getQuotationEmailDraft(actor: QuotationActor, quotationId: string) {
  assertRead(actor, "quotations");
  const quotation = await loadQuotation(quotationId, actor, prisma);
  return buildQuotationEmailDraft(quotation, quotationVersion(quotation));
}

async function auditQuotationEmailSent(
  request: AuditRequest,
  actorId: string,
  payload: QuotationEmailDeliveryPayload,
  delivery: Awaited<ReturnType<typeof finalizeQuotationEmailDelivery>>["delivery"],
  quoteWasCurrent: boolean,
) {
  try {
    await writeAudit(
      request,
      { id: actorId },
      quoteWasCurrent ? "发送客户报价邮件" : "旧版本报价邮件已发出",
      "sales_quotation_deliveries",
      delivery.id,
      null,
      {
        quotationId: payload.quotationId,
        versionNumber: payload.versionNumber,
        delivery: serializeQuotationDelivery(delivery),
        quoteWasCurrent,
        conflictCode: quoteWasCurrent ? null : "QUOTATION_EMAIL_SENT_STALE_VERSION",
      },
    );
  } catch (error: unknown) {
    logServerError("报价邮件发送日志写入失败", error, {
      quotationId: payload.quotationId,
      deliveryId: delivery.id,
    });
  }
}

async function finalizeAndSerialize(
  request: AuditRequest,
  payload: QuotationEmailDeliveryPayload,
  deliveryId: string,
  outboxId?: string | null,
  sentAt?: Date | null,
) {
  const finalized = await finalizeQuotationEmailDelivery({ payload, deliveryId, outboxId, sentAt });
  await auditQuotationEmailSent(request, payload.sentById, payload, finalized.delivery, finalized.quoteWasCurrent);
  if (!finalized.quoteWasCurrent) {
    throw codedError(
      "邮件已经发出，但报价版本或状态已变化，请刷新并核对旧版本发送记录",
      409,
      "QUOTATION_EMAIL_SENT_STALE_VERSION",
    );
  }
  return serializeQuotationDelivery(finalized.delivery);
}

async function reconcileKnownProviderSuccess(
  request: AuditRequest,
  payload: QuotationEmailDeliveryPayload,
  deliveryId: string,
  outboxId?: string | null,
  sentAt?: Date | null,
) {
  try {
    return await finalizeAndSerialize(request, payload, deliveryId, outboxId, sentAt);
  } catch (error: unknown) {
    if ((error as { code?: string } | null)?.code === "QUOTATION_EMAIL_SENT_STALE_VERSION") throw error;
    logServerError("报价邮件已送达但业务状态同步失败", error, {
      quotationId: payload.quotationId,
      deliveryId,
      outboxId: outboxId || null,
    });
    throw codedError(
      "邮件已经发出，但发送状态尚未同步完成，请使用相同请求重试以完成对账",
      503,
      "OUTCOME_RECONCILIATION_REQUIRED",
    );
  }
}

export async function sendQuotationEmail(
  request: AuditRequest,
  actor: QuotationActor,
  quotationId: string,
  input: unknown,
) {
  assertWrite(actor, "quotations");
  assertWrite(actor, "customerCommunication");
  const actorId = requireActorId(actor);
  const quotation = await loadQuotation(quotationId, actor, prisma);
  const rawInput = input as Record<string, unknown> | null;
  const version = quotationVersion(quotation, rawInput?.versionNumber, false);
  const source = draftSource(quotation, version);
  const requestKey = normalizeQuotationEmailRequestKey(rawInput?.requestKey);
  const idempotencyKey = `quotation-email:${quotation.id}:v${version.versionNumber}:${requestKey}`;
  const existing = await prisma.salesQuotationDelivery.findUnique({ where: { idempotencyKey } });
  if (!existing) {
    if (version.versionNumber !== quotation.currentVersionNumber) {
      throw codedError("只能发送报价的当前版本", 409, "QUOTATION_CURRENT_VERSION_REQUIRED");
    }
    if (!(quotation.status === "DRAFT" || quotation.status === "SENT")) {
      throw codedError("当前报价状态不能发送邮件", 409, "QUOTATION_SEND_NOT_ALLOWED");
    }
    assertQuotationVersionNotExpired(version.validUntil);
  }
  const defaults = existing ? persistedDeliveryDraft(existing) : await buildQuotationEmailDraft(quotation, version);
  const normalized = normalizeQuotationEmailSendInput(input, defaults);
  assertQuotationEmailRecipientLimits(normalized.recipientEmails, normalized.ccEmails);
  assertQuotationCustomerEmailRecipients(
    normalized.recipientEmails,
    normalized.ccEmails,
    {
      versionContactEmail: version.contactEmailSnapshot,
      customerContactEmail: quotation.customer.contactEmail,
      shippingDocsEmails: quotation.customer.shippingDocsEmails,
      shippingDocsCcEmails: quotation.customer.shippingDocsCcEmails,
    },
  );
  const document = existing ? {
    id: existing.attachmentFileAssetId || "",
    fileName: existing.attachmentFileName || "",
  } : await ensureQuotationDocument(request, actor, quotationId, { versionNumber: version.versionNumber });
  if (!document.id || !document.fileName) {
    throw codedError("报价邮件发送记录缺少附件信息", 409, "QUOTATION_EMAIL_ATTACHMENT_MISSING");
  }
  const payload: QuotationEmailDeliveryPayload = {
    quotationId: quotation.id,
    quotationVersionId: version.id,
    versionNumber: version.versionNumber,
    idempotencyKey,
    recipientEmails: normalized.recipientEmails,
    ccEmails: normalized.ccEmails,
    subject: normalized.subject,
    body: normalized.body,
    attachmentFileAssetId: document.id,
    attachmentFileName: document.fileName,
    sentById: actorId,
  };
  const claim = await claimQuotationEmailDelivery(payload);
  if (claim.action === "FINALIZE") {
    return reconcileKnownProviderSuccess(request, payload, claim.delivery.id, claim.outboxId, claim.sentAt);
  }

  let file: Awaited<ReturnType<typeof readQuotationDocument>>;
  try {
    file = await readQuotationDocument(actor, quotationId, version.versionNumber);
    if (file.asset.id !== document.id || file.asset.fileName !== document.fileName) {
      throw codedError("报价邮件附件与发送记录不一致", 409, "QUOTATION_EMAIL_ATTACHMENT_MISMATCH");
    }
  } catch (error: unknown) {
    await markDeliveryFailed(claim.delivery.id, idempotencyKey, error);
    throw error;
  }
  let result: Awaited<ReturnType<typeof sendNotificationEmail>>;
  try {
    result = await sendNotificationEmail({
      type: NOTIFICATION_TYPES.QUOTATION_CUSTOMER_EMAIL,
      recipientEmails: normalized.recipientEmails,
      ccEmails: normalized.ccEmails,
      variables: quotationEmailTemplateVariables(source),
      subjectOverride: normalized.subject,
      bodyOverride: normalized.body,
      attachments: [{ filename: document.fileName, content: file.body, contentType: "application/pdf" }],
      idempotencyKey,
      ignoreTemplateCc: true,
      relatedEntityType: "sales_quotation_versions",
      relatedEntityId: version.id,
      context: { quotationId: quotation.id, versionNumber: version.versionNumber, fileAssetId: document.id },
    });
    if (!result.sent) throw codedError(result.error || "报价邮件未发送", 409, "QUOTATION_EMAIL_SKIPPED");
  } catch (error: unknown) {
    const sentOutbox = await findSentOutbox(idempotencyKey);
    if (sentOutbox) {
      return reconcileKnownProviderSuccess(request, payload, claim.delivery.id, sentOutbox.id, sentOutbox.sentAt);
    }
    await markDeliveryFailed(claim.delivery.id, idempotencyKey, error);
    throw error;
  }
  return reconcileKnownProviderSuccess(request, payload, claim.delivery.id, result.outboxId, new Date());
}
