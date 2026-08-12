import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertCustomerScope,
  assertJsonObject,
  assertRead,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import { assertExpectedQuotationVersion } from "./quotation-calculations";
import { quotationAccessWhere } from "./quotation-query-service";
import { todayInChina } from "./quotation-values";
import type { SalesExecutionActor } from "./sales-execution-access";
import { requireSalesExecutionActorId, salesExecutionAccessWhere } from "./sales-execution-access";
import { allocateSalesExecutionNumber } from "./sales-execution-number";
import { loadSalesExecution, salesExecutionDetailInclude } from "./sales-execution-query-service";
import {
  assertSalesExecutionCreationCredentials,
  requiredCustomerOrderNo,
  requiredRequestedDeliveryDate,
  serializeSalesExecution,
} from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";

type AuditRequest = Parameters<typeof writeAudit>[0];

async function lockQuotation(tx: Prisma.TransactionClient, quotationId: string) {
  await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "sales_quotations" WHERE "id" = ${quotationId} FOR UPDATE`,
  );
}

export async function createSalesExecutionFromQuotation(
  request: AuditRequest,
  actor: SalesExecutionActor,
  input: unknown,
) {
  assertRead(actor, "quotations");
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const body = assertJsonObject(input);
  const quotationId = String(body.quotationId || "").trim();
  if (!quotationId) throw codedError("请选择已接受报价", 400, "QUOTATION_REQUIRED");
  const customerOrderNo = requiredCustomerOrderNo(body.customerOrderNo);
  const requestedDeliveryDate = requiredRequestedDeliveryDate(body.requestedDeliveryDate);
  const creationCredentials = { customerOrderNo, requestedDeliveryDate };

  try {
    return await prisma.$transaction(async (tx) => {
      await lockQuotation(tx, quotationId);
      const quotation = await tx.salesQuotation.findFirst({
        where: { id: quotationId, ...quotationAccessWhere(actor) },
        include: {
          customer: true,
          businessEntity: true,
          versions: {
            orderBy: [{ versionNumber: "desc" }],
            include: { items: { orderBy: [{ lineNumber: "asc" }] } },
          },
        },
      });
      if (!quotation) throw codedError("报价不存在或无权访问", 404, "QUOTATION_NOT_FOUND");
      await assertCustomerScope(actor, quotation.customerId, tx);
      assertExpectedQuotationVersion(body, quotation.currentVersionNumber);
      const current = quotation.versions.find(
        (version) => version.versionNumber === quotation.currentVersionNumber,
      );
      if (!current || !current.sealedAt) {
        throw codedError("报价当前版本尚未封存", 409, "QUOTATION_VERSION_NOT_SEALED");
      }
      if (quotation.status !== "ACCEPTED") {
        throw codedError("只有客户已接受的报价才能转为销售执行单", 409, "QUOTATION_NOT_ACCEPTED");
      }
      const acceptedDecision = await tx.salesQuotationDecision.findUnique({
        where: { quotationVersionId: current.id },
        select: { quotationId: true, decision: true, channel: true },
      });
      if (
        acceptedDecision?.quotationId !== quotation.id
        || acceptedDecision.decision !== "ACCEPTED"
        || acceptedDecision.channel === "SYSTEM_EMAIL"
      ) {
        throw codedError(
          "当前报价版本缺少内部手动确认记录",
          409,
          "QUOTATION_MANUAL_ACCEPTANCE_REQUIRED",
        );
      }
      const existing = await tx.salesExecution.findFirst({
        where: { sourceQuotationId: quotation.id, ...salesExecutionAccessWhere(actor) },
        include: salesExecutionDetailInclude,
      });
      if (existing) {
        assertSalesExecutionCreationCredentials(existing, creationCredentials);
        return serializeSalesExecution(existing, true);
      }
      if (!quotation.businessEntityId || !quotation.businessEntity) {
        throw codedError("报价缺少业务主体，不能转为销售执行单", 409, "QUOTATION_BUSINESS_ENTITY_MISSING");
      }
      const salespersonUserId = quotation.salespersonUserId
        || quotation.customer.salespersonUserId
        || actorId;
      const salesperson = await tx.user.findFirst({
        where: { id: salespersonUserId, deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
        select: { id: true },
      });
      if (!salesperson) throw codedError("报价缺少有效业务员", 409, "QUOTATION_SALESPERSON_MISSING");
      const executionDate = todayInChina();
      const executionNo = await allocateSalesExecutionNumber(tx, executionDate);
      const execution = await tx.salesExecution.create({
        data: {
          executionNo,
          executionDate,
          sourceType: "QUOTATION",
          sourceQuotationId: quotation.id,
          sourceQuotationVersionId: current.id,
          customerId: quotation.customerId,
          businessEntityId: quotation.businessEntityId,
          salespersonUserId: salesperson.id,
          customerNameSnapshot: current.customerNameSnapshot,
          customerShortNameSnapshot: current.customerShortNameSnapshot,
          businessEntityNameSnapshot: current.businessEntityNameSnapshot || quotation.businessEntity.name,
          businessEntityShortNameSnapshot: current.businessEntityShortNameSnapshot || quotation.businessEntity.shortName,
          currency: current.currency,
          exchangeRate: current.exchangeRate,
          tradeTerm: current.tradeTerm,
          paymentTerm: current.paymentTerm,
          customerOrderNo: requiredCustomerOrderNo(body.customerOrderNo),
          requestedDeliveryDate: requiredRequestedDeliveryDate(body.requestedDeliveryDate),
          subtotal: current.subtotal,
          totalAmount: current.totalAmount,
          remark: current.remark,
          createdById: actorId,
          updatedById: actorId,
          items: {
            create: current.items.map((item) => ({
              lineNumber: item.lineNumber,
              sourceQuotationItemId: item.id,
              sourceQuotationVersionId: current.id,
              customerProductId: item.customerProductId,
              productFingerprintSnapshot: item.productFingerprintSnapshot,
              productNameSnapshot: item.productNameSnapshot,
              specificationSnapshot: item.specificationSnapshot,
              unitSnapshot: item.unitSnapshot,
              currencySnapshot: item.currencySnapshot,
              quantity: item.quantity,
              unitNetWeightKg: null,
              salesUnitPrice: item.unitPrice,
              salesAmount: item.amount,
              remark: item.remark,
            })),
          },
        },
      });
      await appendSalesExecutionVersion(tx, execution.id, actor);
      const saved = await loadSalesExecution(execution.id, actor, tx);
      const serialized = serializeSalesExecution(saved, true);
      await writeAudit(
        request,
        { id: actorId },
        "从已接受报价创建销售执行单草稿",
        "sales_executions",
        execution.id,
        null,
        serialized,
        tx,
      );
      return serialized;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error: unknown) {
    const code = String((error as { code?: string } | null)?.code || "");
    if (code === "P2002") {
      const existing = await prisma.salesExecution.findFirst({
        where: { sourceQuotationId: quotationId, ...salesExecutionAccessWhere(actor) },
        include: salesExecutionDetailInclude,
      });
      if (existing) {
        assertSalesExecutionCreationCredentials(existing, creationCredentials);
        return serializeSalesExecution(existing, true);
      }
    }
    if (code === "P2034") {
      throw codedError("报价转入发生并发冲突，请重试", 409, "SALES_EXECUTION_CREATE_CONFLICT");
    }
    throw error;
  }
}
