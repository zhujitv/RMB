import { Prisma } from "../generated/prisma/client.js";
import { codedError, writeAudit } from "./shared";
import type { SalesExecutionClient } from "./sales-execution-access";
import {
  productFingerprint,
  productIdentityKey,
  quotationLineAmount,
} from "./quotation-calculations";
import {
  executionText,
  nullableSalesExecutionDecimal,
  salesExecutionDecimal,
} from "./sales-execution-values";

type AuditRequest = Parameters<typeof writeAudit>[0];
type LooseRecord = Record<string, unknown>;

function own(input: LooseRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function itemRows(value: unknown) {
  if (!Array.isArray(value) || value.length < 1) {
    throw codedError("请至少添加一条销售明细", 400, "SALES_EXECUTION_ITEMS_REQUIRED");
  }
  if (value.length > 200) {
    throw codedError("单份销售执行单最多支持 200 条明细", 400, "SALES_EXECUTION_ITEMS_LIMIT");
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw codedError(`第 ${index + 1} 条销售明细格式错误`, 400, "SALES_EXECUTION_ITEM_INVALID");
    }
    return item as LooseRecord;
  });
}

export async function buildDirectSalesExecutionItems(
  client: SalesExecutionClient,
  request: AuditRequest,
  actorId: string,
  customerId: string,
  currency: string,
  rawItems: unknown,
) {
  const rows = itemRows(rawItems);
  const products = await client.customerProduct.findMany({ where: { customerId } });
  const productById = new Map(products.map((product) => [product.id, product]));
  const requestedProductIds = rows
    .map((row) => String(row.customerProductId || "").trim())
    .filter((id, index, all) => id && all.indexOf(id) === index);
  if (requestedProductIds.some((id) => !productById.has(id))) {
    throw codedError("销售明细引用了无效或不属于该客户的产品", 400, "CUSTOMER_PRODUCT_INVALID");
  }
  const productByFingerprint = new Map(products.map((product) => [product.fingerprint, product]));
  const productByIdentity = new Map(products.map((product) => [
    productIdentityKey(customerId, product.name, product.specification, product.unit),
    product,
  ]));

  const normalized = rows.map((row, index) => {
    const requestedId = String(row.customerProductId || "").trim() || null;
    const product = requestedId ? productById.get(requestedId) : null;
    const name = executionText(
      row.name ?? row.productName ?? row.description ?? row.productNameSnapshot ?? product?.name,
      `第 ${index + 1} 行产品描述`,
      200,
      true,
    );
    const specification = executionText(
      own(row, "specification") ? row.specification : (row.specificationSnapshot ?? product?.specification),
      `第 ${index + 1} 行产品描述中的规格`,
      500,
    );
    const unit = executionText(row.unit ?? row.unitSnapshot ?? product?.unit, `第 ${index + 1} 行单位`, 50, true);
    const quantity = salesExecutionDecimal(row.quantity, `第 ${index + 1} 行数量`, {
      positive: true,
      scale: 4,
      integerDigits: 14,
    });
    const salesUnitPrice = salesExecutionDecimal(
      row.salesUnitPrice ?? row.unitPrice,
      `第 ${index + 1} 行销售单价`,
      { scale: 6, integerDigits: 12 },
    );
    const salesAmount = salesExecutionDecimal(
      quotationLineAmount(quantity, salesUnitPrice).toString(),
      `第 ${index + 1} 行销售金额`,
      { scale: 2, integerDigits: 16 },
    );
    const unitNetWeightKg = nullableSalesExecutionDecimal(
      row.unitNetWeightKg,
      `第 ${index + 1} 行单件/单套净重`,
      { positive: true, scale: 6, integerDigits: 12 },
    );
    return {
      lineNumber: index + 1,
      requestedId,
      identityKey: productIdentityKey(customerId, name, specification, unit),
      productFingerprintSnapshot: productFingerprint(customerId, name, specification, unit),
      productNameSnapshot: name,
      specificationSnapshot: specification || null,
      unitSnapshot: unit,
      currencySnapshot: currency,
      quantity,
      unitNetWeightKg,
      salesUnitPrice,
      salesAmount,
      remark: executionText(row.remark, `第 ${index + 1} 行备注`, 1000) || null,
    };
  });

  const linkedByFingerprint = new Map<string, (typeof products)[number]>();
  const result: Array<Omit<(typeof normalized)[number], "requestedId" | "identityKey"> & { customerProductId: string }> = [];
  for (const item of normalized) {
    const requested = item.requestedId ? productById.get(item.requestedId) : null;
    const requestedMatches = requested
      && productIdentityKey(customerId, requested.name, requested.specification, requested.unit) === item.identityKey;
    let linked = linkedByFingerprint.get(item.productFingerprintSnapshot)
      || (requestedMatches ? requested : null)
      || productByIdentity.get(item.identityKey)
      || productByFingerprint.get(item.productFingerprintSnapshot);
    if (!linked) {
      linked = await client.customerProduct.upsert({
        where: { customerId_fingerprint: { customerId, fingerprint: item.productFingerprintSnapshot } },
        update: {},
        create: {
          customerId,
          name: item.productNameSnapshot,
          specification: item.specificationSnapshot,
          unit: item.unitSnapshot,
          fingerprint: item.productFingerprintSnapshot,
          remark: item.remark,
          createdById: actorId,
          updatedById: actorId,
        },
      });
      await writeAudit(
        request,
        { id: actorId },
        "销售执行单自动收录客户产品",
        "customer_products",
        linked.id,
        null,
        linked,
        client,
      );
    } else if (linked.deletedAt) {
      const before = linked;
      linked = await client.customerProduct.update({
        where: { id: linked.id },
        data: { deletedAt: null, updatedById: actorId },
      });
      await writeAudit(
        request,
        { id: actorId },
        "销售执行单自动恢复客户产品",
        "customer_products",
        linked.id,
        before,
        linked,
        client,
      );
    }
    linkedByFingerprint.set(item.productFingerprintSnapshot, linked);
    productByIdentity.set(item.identityKey, linked);
    const { requestedId: _requestedId, identityKey: _identityKey, ...snapshot } = item;
    result.push({ ...snapshot, customerProductId: linked.id });
  }
  return result;
}

export function salesExecutionSubtotal(items: Array<{ salesAmount: Prisma.Decimal }>) {
  return items.reduce((sum, item) => sum.add(item.salesAmount), new Prisma.Decimal(0)).toDecimalPlaces(2);
}
