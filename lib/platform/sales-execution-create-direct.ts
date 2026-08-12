import crypto from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  CURRENCIES,
  assertCustomerScope,
  assertJsonObject,
  assertWrite,
  codedError,
  writeAudit,
} from "./shared";
import { resolveQuotationBusinessEntity } from "./quotation-seller-snapshot";
import { todayInChina } from "./quotation-values";
import type { SalesExecutionActor } from "./sales-execution-access";
import { requireSalesExecutionActorId, salesExecutionAccessWhere } from "./sales-execution-access";
import { buildDirectSalesExecutionItems, salesExecutionSubtotal } from "./sales-execution-direct-items";
import { allocateSalesExecutionNumber } from "./sales-execution-number";
import {
  allocationsForExecutionLines,
  replaceFactoryPurchaseOrderRows,
} from "./sales-execution-purchase-orders";
import { loadSalesExecution, salesExecutionDetailInclude } from "./sales-execution-query-service";
import {
  assertSalesExecutionCreationCredentials,
  executionText,
  requiredCustomerOrderNo,
  requiredRequestedDeliveryDate,
  salesExecutionCurrency,
  salesExecutionDate,
  salesExecutionDecimal,
  serializeSalesExecution,
} from "./sales-execution-values";
import { appendSalesExecutionVersion } from "./sales-execution-version";

type AuditRequest = Parameters<typeof writeAudit>[0];

function creationKey(actorId: string, value: unknown) {
  const requested = executionText(value, "创建请求标识", 200, true);
  return crypto.createHash("sha256").update(`${actorId}\u0000${requested}`).digest("hex");
}

export async function createDirectSalesExecution(
  request: AuditRequest,
  actor: SalesExecutionActor,
  input: unknown,
) {
  assertWrite(actor, "salesExecution");
  const actorId = requireSalesExecutionActorId(actor);
  const body = assertJsonObject(input);
  const idempotencyKey = creationKey(actorId, body.creationKey);
  const customerOrderNo = requiredCustomerOrderNo(body.customerOrderNo);
  const requestedDeliveryDate = requiredRequestedDeliveryDate(body.requestedDeliveryDate);
  const creationCredentials = { customerOrderNo, requestedDeliveryDate };
  const existingRequest = await prisma.salesExecution.findFirst({
    where: { creationKey: idempotencyKey, ...salesExecutionAccessWhere(actor) },
    include: salesExecutionDetailInclude,
  });
  if (existingRequest) {
    assertSalesExecutionCreationCredentials(existingRequest, creationCredentials);
    return serializeSalesExecution(existingRequest, true);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.salesExecution.findFirst({
        where: { creationKey: idempotencyKey, ...salesExecutionAccessWhere(actor) },
        include: salesExecutionDetailInclude,
      });
      if (existing) {
        assertSalesExecutionCreationCredentials(existing, creationCredentials);
        return serializeSalesExecution(existing, true);
      }
      const customerId = executionText(body.customerId, "客户", 100, true);
      const customer = await assertCustomerScope(actor, customerId, tx);
      const businessEntity = await resolveQuotationBusinessEntity(tx, body.businessEntityId);
      const currency = salesExecutionCurrency(body.currency, customer.defaultCurrency || "USD");
      if (!CURRENCIES.includes(currency)) {
        throw codedError("请选择有效币种", 400, "SALES_EXECUTION_CURRENCY_INVALID");
      }
      const executionDate = salesExecutionDate(body.executionDate, "执行单日期", todayInChina());
      if (!executionDate) throw codedError("执行单日期不能为空", 400, "SALES_EXECUTION_DATE_REQUIRED");
      const salespersonUserId = customer.salespersonUserId || actorId;
      const salesperson = await tx.user.findFirst({
        where: { id: salespersonUserId, deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
        select: { id: true },
      });
      if (!salesperson) throw codedError("请选择有效业务员", 400, "SALESPERSON_REQUIRED");
      const items = await buildDirectSalesExecutionItems(
        tx,
        request,
        actorId,
        customer.id,
        currency,
        body.items,
      );
      const subtotal = salesExecutionSubtotal(items);
      const exchangeRate = salesExecutionDecimal(body.exchangeRate ?? "1", "汇率", {
        positive: true,
        scale: 6,
        integerDigits: 12,
      });
      const executionNo = await allocateSalesExecutionNumber(tx, executionDate);
      const execution = await tx.salesExecution.create({
        data: {
          executionNo,
          creationKey: idempotencyKey,
          executionDate,
          sourceType: "DIRECT",
          customerId: customer.id,
          businessEntityId: businessEntity.id,
          salespersonUserId: salesperson.id,
          customerNameSnapshot: customer.name,
          customerShortNameSnapshot: customer.shortName || null,
          businessEntityNameSnapshot: businessEntity.name,
          businessEntityShortNameSnapshot: businessEntity.shortName || null,
          currency,
          exchangeRate,
          tradeTerm: executionText(body.tradeTerm, "贸易条款", 50) || null,
          paymentTerm: executionText(body.paymentTerm, "付款条款", 500) || null,
          customerOrderNo: requiredCustomerOrderNo(body.customerOrderNo),
          requestedDeliveryDate: requiredRequestedDeliveryDate(body.requestedDeliveryDate),
          subtotal,
          totalAmount: subtotal,
          remark: executionText(body.remark, "备注", 5000) || null,
          createdById: actorId,
          updatedById: actorId,
          items: { create: items },
        },
      });
      const executionWithItems = await loadSalesExecution(execution.id, actor, tx);
      const allocations = allocationsForExecutionLines(body.allocations, executionWithItems.items);
      await replaceFactoryPurchaseOrderRows(tx, actorId, executionWithItems, allocations);
      await appendSalesExecutionVersion(tx, execution.id, actor);
      const saved = await loadSalesExecution(execution.id, actor, tx);
      const serialized = serializeSalesExecution(saved, true);
      await writeAudit(
        request,
        { id: actorId },
        "直接创建销售执行单草稿",
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
        where: { creationKey: idempotencyKey, ...salesExecutionAccessWhere(actor) },
        include: salesExecutionDetailInclude,
      });
      if (existing) {
        assertSalesExecutionCreationCredentials(existing, creationCredentials);
        return serializeSalesExecution(existing, true);
      }
    }
    if (code === "P2034") {
      throw codedError("销售执行单创建冲突，请重试", 409, "SALES_EXECUTION_CREATE_CONFLICT");
    }
    throw error;
  }
}
