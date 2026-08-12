import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { canWrite, codedError } from "./shared";
import {
  QUOTATION_EMAIL_LEASE_MS,
  QUOTATION_EMAIL_QUOTE_DAY_LIMIT,
  QUOTATION_EMAIL_USER_MINUTE_LIMIT,
  assertQuotationVersionNotExpired,
  quotationEmailClaimDisposition,
  quotationEmailPayloadMatches,
  startOfChinaDay,
  type QuotationEmailDeliveryPayload,
  type QuotationEmailDeliverySnapshot,
} from "./quotation-email-delivery-rules";
import { assertQuotationCustomerEmailRecipients } from "./quotation-email-recipients";
import { quotationAccessWhere } from "./quotation-query-service";

export type QuotationEmailClaimResult = {
  action: "SEND" | "FINALIZE";
  delivery: QuotationEmailDeliverySnapshot;
  outboxId: string | null;
  sentAt: Date | null;
};

export async function lockQuotationForEmailMutation(client: Prisma.TransactionClient, quotationId: string) {
  await client.$queryRaw(Prisma.sql`
    SELECT "id" FROM "sales_quotations" WHERE "id" = ${quotationId} FOR UPDATE
  `);
}

async function lockQuotationEmailActor(client: Prisma.TransactionClient, actorId: string) {
  await client.$queryRaw(Prisma.sql`
    SELECT "id" FROM "users" WHERE "id" = ${actorId} FOR UPDATE
  `);
  const actor = await client.user.findFirst({
    where: {
      id: actorId,
      deletedAt: null,
      isActive: true,
      approvalStatus: "APPROVED",
      emailVerified: true,
      mustChangePassword: false,
      passwordPolicyPassed: true,
    },
    select: { id: true, role: true, customPermissions: true },
  });
  if (
    !actor
    || !canWrite(actor, "quotations")
    || !canWrite(actor, "customerCommunication")
  ) {
    throw codedError("账号或报价邮件权限已变化，请重新登录后重试", 403, "QUOTATION_EMAIL_ACTOR_NOT_AUTHORIZED");
  }
  return actor;
}

export async function assertNoActiveQuotationEmailLease(
  client: Prisma.TransactionClient,
  quotationId: string,
  quotationVersionId?: string,
  now = new Date(),
) {
  const active = await client.salesQuotationDelivery.findFirst({
    where: {
      quotationId,
      ...(quotationVersionId ? { quotationVersionId } : {}),
      status: "PENDING",
      updatedAt: { gte: new Date(now.getTime() - QUOTATION_EMAIL_LEASE_MS) },
    },
    select: { id: true },
  });
  if (active) {
    throw codedError("报价邮件正在发送中，请稍后再修改报价状态", 409, "QUOTATION_EMAIL_LEASE_ACTIVE");
  }
}

async function validateCurrentSendTarget(
  client: Prisma.TransactionClient,
  payload: QuotationEmailDeliveryPayload,
  actor: Awaited<ReturnType<typeof lockQuotationEmailActor>>,
) {
  const [quotation, version] = await Promise.all([
    client.salesQuotation.findFirst({
      where: { id: payload.quotationId, ...quotationAccessWhere(actor) },
      select: {
        status: true,
        currentVersionNumber: true,
        customer: {
          select: {
            contactEmail: true,
            shippingDocsEmails: true,
            shippingDocsCcEmails: true,
          },
        },
      },
    }),
    client.salesQuotationVersion.findUnique({
      where: { id: payload.quotationVersionId },
      select: {
        quotationId: true,
        versionNumber: true,
        validUntil: true,
        contactEmailSnapshot: true,
      },
    }),
  ]);
  if (!quotation || !version || version.quotationId !== payload.quotationId) {
    throw codedError("报价当前版本不存在", 409, "QUOTATION_CURRENT_VERSION_REQUIRED");
  }
  if (quotation.currentVersionNumber !== payload.versionNumber || version.versionNumber !== payload.versionNumber) {
    throw codedError("报价已生成新版本，请刷新后重新发送", 409, "QUOTATION_CURRENT_VERSION_REQUIRED");
  }
  if (!(quotation.status === "DRAFT" || quotation.status === "SENT")) {
    throw codedError("当前报价状态不能发送邮件", 409, "QUOTATION_SEND_NOT_ALLOWED");
  }
  assertQuotationCustomerEmailRecipients(
    payload.recipientEmails,
    payload.ccEmails,
    {
      versionContactEmail: version.contactEmailSnapshot,
      customerContactEmail: quotation.customer.contactEmail,
      shippingDocsEmails: quotation.customer.shippingDocsEmails,
      shippingDocsCcEmails: quotation.customer.shippingDocsCcEmails,
    },
  );
  assertQuotationVersionNotExpired(version.validUntil);
}

async function assertNewSendRateLimits(
  client: Prisma.TransactionClient,
  payload: QuotationEmailDeliveryPayload,
  now = new Date(),
) {
  const [actorMinuteCount, quotationDayCount] = await Promise.all([
    client.salesQuotationDelivery.count({
      where: { sentById: payload.sentById, createdAt: { gte: new Date(now.getTime() - 60_000) } },
    }),
    client.salesQuotationDelivery.count({
      where: { quotationId: payload.quotationId, createdAt: { gte: startOfChinaDay(now) } },
    }),
  ]);
  if (actorMinuteCount >= QUOTATION_EMAIL_USER_MINUTE_LIMIT) {
    throw codedError("报价邮件发送过于频繁，请一分钟后再试", 429, "QUOTATION_EMAIL_USER_RATE_LIMIT");
  }
  if (quotationDayCount >= QUOTATION_EMAIL_QUOTE_DAY_LIMIT) {
    throw codedError("该报价今天的邮件发送次数已达上限", 429, "QUOTATION_EMAIL_QUOTE_RATE_LIMIT");
  }
}

async function outboxFor(client: Prisma.TransactionClient | typeof prisma, idempotencyKey: string) {
  return client.notificationOutbox.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, sentAt: true, updatedAt: true },
  });
}

function createData(payload: QuotationEmailDeliveryPayload) {
  return {
    quotationId: payload.quotationId,
    quotationVersionId: payload.quotationVersionId,
    idempotencyKey: payload.idempotencyKey,
    status: "PENDING" as const,
    recipientEmails: payload.recipientEmails,
    ccEmails: payload.ccEmails,
    subject: payload.subject,
    body: payload.body,
    attachmentFileAssetId: payload.attachmentFileAssetId,
    attachmentFileName: payload.attachmentFileName,
    attempts: 1,
    sentById: payload.sentById,
  };
}

function inProgressError() {
  return codedError("相同报价邮件正在发送中，请勿重复提交", 409, "QUOTATION_EMAIL_IN_PROGRESS");
}

async function handleExistingClaim(
  client: Prisma.TransactionClient,
  delivery: QuotationEmailDeliverySnapshot,
  payload: QuotationEmailDeliveryPayload,
  actor: Awaited<ReturnType<typeof lockQuotationEmailActor>>,
): Promise<QuotationEmailClaimResult> {
  const outbox = await outboxFor(client, payload.idempotencyKey);
  const disposition = quotationEmailClaimDisposition(delivery, outbox, payload);
  if (disposition === "FINALIZE") {
    return {
      action: "FINALIZE",
      delivery,
      outboxId: outbox?.id || delivery.outboxId,
      sentAt: outbox?.sentAt || delivery.sentAt,
    };
  }
  if (disposition === "IN_PROGRESS") throw inProgressError();
  await validateCurrentSendTarget(client, payload, actor);
  const claimed = await client.salesQuotationDelivery.updateMany({
    where: { id: delivery.id, status: delivery.status, updatedAt: delivery.updatedAt },
    data: { status: "PENDING", attempts: { increment: 1 }, sentById: payload.sentById, lastError: null, failedAt: null },
  });
  if (claimed.count !== 1) throw inProgressError();
  const refreshed = await client.salesQuotationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  return { action: "SEND", delivery: refreshed, outboxId: null, sentAt: null };
}

async function retryExistingClaim(payload: QuotationEmailDeliveryPayload) {
  return prisma.$transaction(async (tx) => {
    const actor = await lockQuotationEmailActor(tx, payload.sentById);
    await lockQuotationForEmailMutation(tx, payload.quotationId);
    const delivery = await tx.salesQuotationDelivery.findUnique({ where: { idempotencyKey: payload.idempotencyKey } });
    if (!delivery) throw codedError("报价邮件发送记录不存在", 409, "QUOTATION_EMAIL_DELIVERY_MISSING");
    return handleExistingClaim(tx, delivery, payload, actor);
  });
}

export async function claimQuotationEmailDelivery(payload: QuotationEmailDeliveryPayload) {
  try {
    return await prisma.$transaction(async (tx) => {
      const actor = await lockQuotationEmailActor(tx, payload.sentById);
      await lockQuotationForEmailMutation(tx, payload.quotationId);
      const existing = await tx.salesQuotationDelivery.findUnique({ where: { idempotencyKey: payload.idempotencyKey } });
      if (existing) return handleExistingClaim(tx, existing, payload, actor);
      await validateCurrentSendTarget(tx, payload, actor);
      await assertNewSendRateLimits(tx, payload);
      const delivery = await tx.salesQuotationDelivery.create({ data: createData(payload) });
      return { action: "SEND", delivery, outboxId: null, sentAt: null } as QuotationEmailClaimResult;
    });
  } catch (error: unknown) {
    if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    const existing = await prisma.salesQuotationDelivery.findUnique({ where: { idempotencyKey: payload.idempotencyKey } });
    if (!existing) throw error;
    return retryExistingClaim(payload);
  }
}

export async function finalizeQuotationEmailDelivery(input: {
  payload: QuotationEmailDeliveryPayload;
  deliveryId: string;
  outboxId?: string | null;
  sentAt?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    await lockQuotationForEmailMutation(tx, input.payload.quotationId);
    const before = await tx.salesQuotationDelivery.findUnique({ where: { id: input.deliveryId } });
    if (!before || !quotationEmailPayloadMatches(before, input.payload)) {
      throw codedError("报价邮件发送记录与请求不一致", 409, "QUOTATION_EMAIL_DELIVERY_MISMATCH");
    }
    const delivery = await tx.salesQuotationDelivery.update({
      where: { id: before.id },
      data: {
        status: "SENT",
        outboxId: input.outboxId || before.outboxId || undefined,
        sentAt: input.sentAt || before.sentAt || new Date(),
        failedAt: null,
        lastError: null,
      },
    });
    const quotation = await tx.salesQuotation.updateMany({
      where: {
        id: input.payload.quotationId,
        currentVersionNumber: input.payload.versionNumber,
        status: { in: ["DRAFT", "SENT"] },
      },
      data: { status: "SENT", updatedById: input.payload.sentById },
    });
    return { delivery, quoteWasCurrent: quotation.count === 1 };
  });
}
