import { createHash } from "node:crypto";
import { Prisma, type FactoryPurchaseOrderPriceCorrection } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { assertWrite } from "./shared-access";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import { assertBusinessOrderWritableInTransaction } from "./business-archive";
import {
  factoryLedgerIdempotencyKey,
  factoryLedgerInput,
  factoryLedgerText,
  runFactoryPurchaseMutation,
} from "./factory-purchase-order-ledger-values";
import {
  assertPriceCorrectionAllowed,
  correctionQuantitySnapshot,
  currentApprovedUnitPrice,
  factoryCorrectionAmounts,
  factoryCorrectionUnitPrice,
  loadPurchaseOrderWithPriceCorrections,
  type PriceCorrectionAuditRequest,
} from "./factory-purchase-order-price-correction-values";
import {
  lockFactoryPurchaseOrder,
  requireSalesExecutionActorId,
  type SalesExecutionActor,
} from "./sales-execution-access";

const MAX_BATCH_LINES = 100;

type ParsedBatchLine = {
  purchaseOrderItemId: string;
  newUnitPrice: Prisma.Decimal;
};

function batchLineIdempotencyKey(batchKey: string, lineNo: number) {
  const digest = createHash("sha256").update(batchKey).digest("hex");
  return `price-correction-batch:${digest}:${lineNo}`;
}

function parseBatchLines(input: Record<string, unknown>) {
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > MAX_BATCH_LINES) {
    throw codedError(
      `批量采购价格更正必须包含 1 至 ${MAX_BATCH_LINES} 个产品行`,
      400,
      "FACTORY_PRICE_CORRECTION_BATCH_ITEMS_INVALID",
    );
  }
  const parsed = input.items.map((value, index): ParsedBatchLine => {
    const row = factoryLedgerInput(value, `第 ${index + 1} 个价格更正产品行`);
    const purchaseOrderItemId = factoryLedgerText(row.purchaseOrderItemId, "产品行", 200);
    if (!purchaseOrderItemId) {
      throw codedError("请选择需要更正价格的产品行", 400, "FACTORY_PRICE_CORRECTION_ITEM_REQUIRED");
    }
    return { purchaseOrderItemId, newUnitPrice: factoryCorrectionUnitPrice(row.newUnitPrice) };
  });
  if (new Set(parsed.map((row) => row.purchaseOrderItemId)).size !== parsed.length) {
    throw codedError(
      "同一个产品行不能在一批价格更正中重复出现",
      400,
      "FACTORY_PRICE_CORRECTION_BATCH_ITEM_DUPLICATE",
    );
  }
  return parsed;
}

function assertBatchReplay(
  existing: Array<{
    batchLineNo: number | null;
    batchLineCount: number | null;
    purchaseOrderItemId: string;
    newUnitPrice: Prisma.Decimal;
    deltaAmount: Prisma.Decimal;
    reason: string;
  }>,
  lines: ParsedBatchLine[],
  reason: string,
) {
  const ordered = [...existing].sort((left, right) => (left.batchLineNo || 0) - (right.batchLineNo || 0));
  const exact = ordered.length === lines.length
    && ordered.every((row, index) => row.batchLineNo === index + 1
      && row.batchLineCount === lines.length
      && row.purchaseOrderItemId === lines[index]?.purchaseOrderItemId
      && row.newUnitPrice.eq(lines[index]!.newUnitPrice)
      && row.reason === reason);
  if (!exact) {
    throw codedError(
      "同一提交凭证对应的批量采购价格更正内容不一致，请刷新后重新提交",
      409,
      "FACTORY_PRICE_CORRECTION_IDEMPOTENCY_CONFLICT",
    );
  }
  return ordered;
}

export async function requestFactoryPurchaseOrderPriceCorrectionBatch(
  request: PriceCorrectionAuditRequest,
  actor: SalesExecutionActor,
  executionId: string,
  purchaseOrderId: string,
  rawInput: unknown,
) {
  assertWrite(actor, "costs");
  const actorId = requireSalesExecutionActorId(actor);
  const input = factoryLedgerInput(rawInput, "批量采购价格更正申请");
  const lines = parseBatchLines(input);
  const reason = factoryLedgerText(input.reason, "更正原因", 2_000);
  if (!reason) throw codedError("请填写采购价格更正原因", 400, "FACTORY_PRICE_CORRECTION_REASON_REQUIRED");
  const batchId = factoryLedgerIdempotencyKey(input.idempotencyKey);

  return runFactoryPurchaseMutation(() => prisma.$transaction(async (tx) => {
    await lockFactoryPurchaseOrder(tx, purchaseOrderId);
    const before = await loadPurchaseOrderWithPriceCorrections(tx, executionId, purchaseOrderId, actor);
    const existing = before.priceCorrections.filter((correction) => correction.batchId === batchId);
    if (existing.length) {
      const corrections = assertBatchReplay(existing, lines, reason);
      return { batchId, corrections, totalDeltaAmount: corrections.reduce(
        (sum, correction) => sum.add(correction.deltaAmount),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2) };
    }

    assertPriceCorrectionAllowed(before);
    const orderId = before.execution.receivableOrder?.id || "";
    if (orderId) {
      await assertBusinessOrderWritableInTransaction(
        tx,
        orderId,
        "该订单已提交退税并归档，不能申请采购价格更正。",
      );
    }

    const prepared = lines.map((line, index) => {
      const item = before.items.find((candidate) => candidate.id === line.purchaseOrderItemId);
      if (!item) throw codedError("采购单产品行不存在", 404, "FACTORY_PRICE_CORRECTION_ITEM_NOT_FOUND");
      const pending = before.priceCorrections.find((correction) => (
        correction.purchaseOrderItemId === line.purchaseOrderItemId && correction.status === "PENDING"
      ));
      if (pending) {
        throw codedError(
          `第 ${index + 1} 个产品行已有待审核的采购价格更正申请`,
          409,
          "FACTORY_PRICE_CORRECTION_PENDING_EXISTS",
        );
      }
      const currentPrice = currentApprovedUnitPrice(before, item);
      const oldUnitPrice = currentPrice.unitPrice;
      if (!oldUnitPrice) {
        throw codedError("该产品行原采购单价为空，不能申请价格更正", 409, "FACTORY_PRICE_CORRECTION_OLD_PRICE_MISSING");
      }
      if (oldUnitPrice.eq(line.newUnitPrice)) {
        throw codedError(
          `第 ${index + 1} 个产品行更正后的采购单价与当前单价相同`,
          400,
          "FACTORY_PRICE_CORRECTION_NO_CHANGE",
        );
      }
      const quantitySnapshot = correctionQuantitySnapshot(before, item);
      return {
        item,
        oldUnitPrice,
        newUnitPrice: line.newUnitPrice,
        quantitySnapshot,
        sourceUnitPriceType: currentPrice.sourceType,
        ...factoryCorrectionAmounts(quantitySnapshot, oldUnitPrice, line.newUnitPrice),
      };
    });

    const firstSequenceNo = before.priceCorrections.reduce(
      (max, correction) => Math.max(max, correction.sequenceNo),
      0,
    ) + 1;
    const corrections: FactoryPurchaseOrderPriceCorrection[] = [];
    for (const [index, row] of prepared.entries()) {
      const saved = await tx.factoryPurchaseOrderPriceCorrection.create({
        data: {
          purchaseOrderId: before.id,
          purchaseOrderItemId: row.item.id,
          sequenceNo: firstSequenceNo + index,
          quantitySnapshot: row.quantitySnapshot,
          oldUnitPrice: row.oldUnitPrice,
          newUnitPrice: row.newUnitPrice,
          oldAmount: row.oldAmount,
          newAmount: row.newAmount,
          deltaAmount: row.deltaAmount,
          currency: before.purchaseCurrency,
          reason,
          sourceUnitPriceType: row.sourceUnitPriceType,
          idempotencyKey: batchLineIdempotencyKey(batchId, index + 1),
          batchId,
          batchLineNo: index + 1,
          batchLineCount: prepared.length,
          requestedById: actorId,
        },
      });
      corrections.push(saved);
      await writeAudit(
        request,
        { id: actorId },
        "提交批量采购价格更正申请",
        "factory_purchase_order_price_corrections",
        saved.id,
        null,
        saved,
        tx,
      );
    }
    await tx.factoryPurchaseOrder.update({
      where: { id: before.id },
      data: { revision: { increment: 1 }, updatedById: actorId },
    });
    return {
      batchId,
      corrections,
      totalDeltaAmount: corrections.reduce(
        (sum, correction) => sum.add(correction.deltaAmount),
        new Prisma.Decimal(0),
      ).toDecimalPlaces(2),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
