import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import {
  loadQuotation,
} from "./quotation-query-service";
import { allocateQuotationInvoiceNumber } from "./quotation-invoice-number";
import { buildQuotationVersionData } from "./quotation-version-builder";
import {
  assertExpectedQuotationVersion,
  assertQuotationCustomerImmutable,
} from "./quotation-calculations";
import { getCompanyProfileSettings } from "./company-profile";
import {
  buildQuotationSellerSnapshot,
  resolveQuotationBusinessEntity,
} from "./quotation-seller-snapshot";
import {
  assertNoActiveQuotationEmailLease,
  lockQuotationForEmailMutation,
} from "./quotation-email-delivery-claim";
import {
  quotationText,
  serializeQuotation,
  type QuotationActor,
} from "./quotation-values";

export {
  getQuotation,
  listQuotations,
  quotationAccessWhere,
} from "./quotation-query-service";

type AuditRequest = Parameters<typeof writeAudit>[0];
type LooseRecord = Record<string, unknown>;

function own(input: LooseRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function requireActorId(actor: QuotationActor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

export async function createQuotation(request: AuditRequest, actor: QuotationActor, input: unknown) {
  assertWrite(actor, "quotations");
  const actorId = requireActorId(actor);
  const body = assertJsonObject(input);
  const customerId = quotationText(body.customerId, "客户", 100, true);
  const companyProfile = await getCompanyProfileSettings();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const customer = await assertCustomerScope(actor, customerId, tx);
        const businessEntity = await resolveQuotationBusinessEntity(tx, body.businessEntityId);
        const versionData = await buildQuotationVersionData(tx, body, customer, actorId, request);
        const sellerSnapshot = buildQuotationSellerSnapshot(businessEntity, companyProfile, versionData.currency);
        const invoiceNo = await allocateQuotationInvoiceNumber(tx, versionData.quoteDate);
        const quotation = await tx.salesQuotation.create({
          data: {
            quoteNo: invoiceNo,
            invoiceNo,
            customerId: customer.id,
            businessEntityId: businessEntity.id,
            salespersonUserId: customer.salespersonUserId || (actor?.role === "业务员" ? actorId : null),
            createdById: actorId,
            updatedById: actorId,
          },
        });
        const version = await tx.salesQuotationVersion.create({
          data: {
            quotationId: quotation.id,
            versionNumber: 1,
            invoiceNoSnapshot: invoiceNo,
            ...versionData,
            ...sellerSnapshot,
            items: { create: versionData.items },
          },
        });
        await tx.salesQuotationVersion.update({ where: { id: version.id }, data: { sealedAt: new Date() } });
        const saved = await loadQuotation(quotation.id, actor, tx);
        const serialized = serializeQuotation(saved, true);
        await writeAudit(request, { id: actorId }, "新增报价草稿", "sales_quotations", quotation.id, null, serializeQuotation(saved), tx);
        return serialized;
      });
    } catch (error: unknown) {
      if ((error as { code?: string } | null)?.code === "P2002" && attempt < 2) continue;
      throw error;
    }
  }
  throw codedError("报价号生成冲突，请重试", 409, "QUOTATION_NUMBER_CONFLICT");
}

export async function updateQuotation(request: AuditRequest, actor: QuotationActor, id: string, input: unknown) {
  assertWrite(actor, "quotations");
  const actorId = requireActorId(actor);
  const body = assertJsonObject(input);
  const companyProfile = await getCompanyProfileSettings();
  try {
    return await prisma.$transaction(async (tx) => {
      await lockQuotationForEmailMutation(tx, id);
      const before = await loadQuotation(id, actor, tx);
      const customer = await assertCustomerScope(actor, before.customerId, tx);
      if (!["DRAFT", "SENT", "REJECTED"].includes(before.status)) {
        throw codedError("已接受或已作废报价不能继续修改", 409, "QUOTATION_NOT_EDITABLE");
      }
      const current = before.versions[0];
      if (!current) throw codedError("报价当前版本不存在", 500, "QUOTATION_VERSION_MISSING");
      await assertNoActiveQuotationEmailLease(tx, before.id, current.id);
      assertExpectedQuotationVersion(body, before.currentVersionNumber);
      const requestedCustomerId = own(body, "customerId")
        ? quotationText(body.customerId, "客户", 100, true)
        : before.customerId;
      assertQuotationCustomerImmutable(requestedCustomerId, before.customerId);
      const businessEntity = await resolveQuotationBusinessEntity(tx, body.businessEntityId, before.businessEntityId || "");
      const versionData = await buildQuotationVersionData(
        tx,
        body,
        customer,
        actorId,
        request,
        current as unknown as LooseRecord,
      );
      const sellerSnapshot = buildQuotationSellerSnapshot(businessEntity, companyProfile, versionData.currency);
      const invoiceNo = before.invoiceNo || await allocateQuotationInvoiceNumber(tx, versionData.quoteDate);
      const nextVersionNumber = before.currentVersionNumber + 1;
      const version = await tx.salesQuotationVersion.create({
        data: {
          quotationId: before.id,
          versionNumber: nextVersionNumber,
          invoiceNoSnapshot: invoiceNo,
          ...versionData,
          ...sellerSnapshot,
          items: { create: versionData.items },
        },
      });
      await tx.salesQuotationVersion.update({ where: { id: version.id }, data: { sealedAt: new Date() } });
      const updated = await tx.salesQuotation.updateMany({
        where: {
          id: before.id,
          status: before.status,
          currentVersionNumber: before.currentVersionNumber,
        },
        data: {
          invoiceNo,
          businessEntityId: businessEntity.id,
          currentVersionNumber: nextVersionNumber,
          status: "DRAFT",
          updatedById: actorId,
        },
      });
      if (updated.count !== 1) {
        throw codedError("报价已被其他用户更新，请刷新后重试", 409, "QUOTATION_VERSION_CONFLICT");
      }
      const saved = await loadQuotation(before.id, actor, tx);
      await writeAudit(request, { id: actorId }, "更新报价草稿并生成版本", "sales_quotations", before.id, serializeQuotation(before), serializeQuotation(saved), tx);
      return serializeQuotation(saved, true);
    });
  } catch (error: unknown) {
    if (["P2002", "P2034"].includes(String((error as { code?: string } | null)?.code || ""))) {
      throw codedError("报价已被其他用户更新，请刷新后重试", 409, "QUOTATION_VERSION_CONFLICT");
    }
    throw error;
  }
}

export async function voidQuotation(
  request: AuditRequest,
  actor: QuotationActor,
  id: string,
  input: unknown = {},
) {
  assertWrite(actor, "quotations");
  const actorId = requireActorId(actor);
  const body = assertJsonObject(input);
  const reason = quotationText(body.reason ?? body.voidReason, "作废原因", 500) || "用户作废";
  return prisma.$transaction(async (tx) => {
    await lockQuotationForEmailMutation(tx, id);
    const before = await loadQuotation(id, actor, tx);
    await assertCustomerScope(actor, before.customerId, tx);
    assertExpectedQuotationVersion(body, before.currentVersionNumber);
    if (before.status === "VOIDED") return serializeQuotation(before, true);
    if (before.status === "ACCEPTED") {
      throw codedError("客户已接受的报价不能作废", 409, "QUOTATION_ACCEPTED_LOCKED");
    }
    const current = before.versions.find((version) => version.versionNumber === before.currentVersionNumber);
    if (!current) throw codedError("报价当前版本不存在", 500, "QUOTATION_VERSION_MISSING");
    await assertNoActiveQuotationEmailLease(tx, before.id, current.id);
    const changed = await tx.salesQuotation.updateMany({
      where: { id: before.id, status: { in: ["DRAFT", "SENT", "REJECTED"] } },
      data: {
        status: "VOIDED",
        voidedAt: new Date(),
        voidedById: actorId,
        voidReason: reason,
        updatedById: actorId,
      },
    });
    if (changed.count !== 1) throw codedError("报价状态已变化，请刷新后重试", 409, "QUOTATION_STATUS_CONFLICT");
    const saved = await loadQuotation(before.id, actor, tx);
    await writeAudit(request, { id: actorId }, "作废报价", "sales_quotations", before.id, serializeQuotation(before), serializeQuotation(saved), tx);
    return serializeQuotation(saved, true);
  });
}
