import type { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-utils";
import {
  executionText,
  nullableSalesExecutionDecimal,
} from "./sales-execution-values";

type LooseRecord = Record<string, unknown>;

function own(input: LooseRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function assertQuotationUpdateFields(body: LooseRecord) {
  const allowed = new Set([
    "expectedRevision",
    "customerOrderNo",
    "requestedDeliveryDate",
    "remark",
    "allocations",
    "itemWeights",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw codedError(
      "报价转入的客户、主体、币种、条款、销售数量和销售价格不能修改",
      409,
      "QUOTATION_EXECUTION_SALES_FIELDS_LOCKED",
    );
  }
}

function quotationItemWeightRows(value: unknown, items: Array<{ id: string }>) {
  if (!Array.isArray(value) || value.length !== items.length) {
    throw codedError(
      "报价转入的重量更新必须包含当前全部销售明细",
      400,
      "SALES_EXECUTION_ITEM_WEIGHTS_INCOMPLETE",
    );
  }
  const validIds = new Set(items.map((item) => item.id));
  const seenIds = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw codedError(
        `第 ${index + 1} 条重量记录格式错误`,
        400,
        "SALES_EXECUTION_ITEM_WEIGHT_INVALID",
      );
    }
    const row = raw as LooseRecord;
    const allowed = new Set(["executionItemId", "unitNetWeightKg"]);
    if (Object.keys(row).some((key) => !allowed.has(key)) || !own(row, "unitNetWeightKg")) {
      throw codedError(
        "报价转入明细只能修改单件/单套净重",
        409,
        "QUOTATION_EXECUTION_SALES_FIELDS_LOCKED",
      );
    }
    const executionItemId = executionText(
      row.executionItemId,
      `第 ${index + 1} 条销售明细`,
      100,
      true,
    );
    if (!validIds.has(executionItemId)) {
      throw codedError(
        "重量更新引用了无效的销售明细",
        400,
        "SALES_EXECUTION_ITEM_WEIGHT_ITEM_INVALID",
      );
    }
    if (seenIds.has(executionItemId)) {
      throw codedError(
        "同一销售明细的重量不能重复提交",
        400,
        "SALES_EXECUTION_ITEM_WEIGHT_DUPLICATE",
      );
    }
    seenIds.add(executionItemId);
    return {
      executionItemId,
      unitNetWeightKg: nullableSalesExecutionDecimal(
        row.unitNetWeightKg,
        `第 ${index + 1} 行单件/单套净重`,
        { positive: true, scale: 6, integerDigits: 12 },
      ),
    };
  });
}

export function prepareSalesExecutionItemWeightUpdates(
  sourceType: string,
  body: LooseRecord,
  items: Array<{ id: string }>,
) {
  if (sourceType === "QUOTATION") {
    assertQuotationUpdateFields(body);
    return own(body, "itemWeights")
      ? quotationItemWeightRows(body.itemWeights, items)
      : null;
  }
  if (own(body, "itemWeights")) {
    throw codedError(
      "直接创建的销售明细请通过 items 更新重量",
      400,
      "SALES_EXECUTION_ITEM_WEIGHTS_UNSUPPORTED",
    );
  }
  return null;
}

export async function applySalesExecutionItemWeightUpdates(
  tx: Prisma.TransactionClient,
  executionId: string,
  updates: ReturnType<typeof quotationItemWeightRows> | null,
) {
  if (!updates) return;
  for (const item of updates) {
    const updated = await tx.salesExecutionItem.updateMany({
      where: { id: item.executionItemId, executionId },
      data: { unitNetWeightKg: item.unitNetWeightKg },
    });
    if (updated.count !== 1) {
      throw codedError(
        "销售明细已变化，请刷新后重试",
        409,
        "SALES_EXECUTION_ITEM_WEIGHT_CONFLICT",
      );
    }
  }
}
