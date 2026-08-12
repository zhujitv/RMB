import { Prisma } from "../generated/prisma/client.js";
import { CURRENCIES, codedError, writeAudit } from "./shared";
import type { QuotationClient } from "./quotation-query-service";
import {
  productIdentityKey,
  productFingerprint,
  quotationDate,
  quotationDecimal,
  quotationLineAmount,
  quotationText,
  todayInChina,
} from "./quotation-values";

type AuditRequest = Parameters<typeof writeAudit>[0];
type LooseRecord = Record<string, unknown>;
type QuotationCustomerSnapshot = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
  defaultCurrency: string | null;
  salespersonUserId: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

function own(input: LooseRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function nullableInteger(input: unknown, label: string, fallback: number | null) {
  if (input === undefined) return fallback;
  if (input === null || String(input).trim() === "") return null;
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 0 || value > 3650) {
    throw codedError(`${label}必须是 0 到 3650 之间的整数`, 400, "QUOTATION_INTEGER_INVALID");
  }
  return value;
}

function currentValue(current: LooseRecord | null, key: string, fallback: unknown) {
  return current && current[key] !== undefined ? current[key] : fallback;
}

function itemInputFromSnapshot(value: unknown) {
  const item = value && typeof value === "object" ? value as LooseRecord : {};
  return {
    customerProductId: item.customerProductId,
    name: item.productNameSnapshot,
    specification: item.specificationSnapshot,
    unit: item.unitSnapshot,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    remark: item.remark,
  };
}

async function quotationItemsData(
  client: QuotationClient,
  customerId: string,
  currency: string,
  rawItems: unknown,
  actorId: string,
  request: AuditRequest,
) {
  if (!Array.isArray(rawItems) || rawItems.length < 1) {
    throw codedError("请至少添加一条报价明细", 400, "QUOTATION_ITEMS_REQUIRED");
  }
  if (rawItems.length > 200) throw codedError("单份报价最多支持 200 条明细", 400, "QUOTATION_ITEMS_LIMIT");
  const rows = rawItems.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw codedError(`第 ${index + 1} 条报价明细格式错误`, 400, "QUOTATION_ITEM_INVALID");
    }
    return value as LooseRecord;
  });
  const productIds = rows
    .map((row) => String(row.customerProductId || "").trim())
    .filter((id, index, all) => id && all.indexOf(id) === index);
  const products = await client.customerProduct.findMany({ where: { customerId } });
  const productById = new Map(products.map((product) => [product.id, product]));
  if (productIds.some((id) => !productById.has(id))) {
    throw codedError("报价明细引用了无效或不属于该客户的产品", 400, "CUSTOMER_PRODUCT_INVALID");
  }
  const productByFingerprint = new Map(products.map((product) => [product.fingerprint, product]));
  const productByIdentity = new Map(products.map((product) => [
    productIdentityKey(customerId, product.name, product.specification, product.unit),
    product,
  ]));
  const normalizedItems = rows.map((row, index) => {
    const customerProductId = String(row.customerProductId || "").trim() || null;
    const product = customerProductId ? productById.get(customerProductId) : null;
    const requestedName = row.name ?? row.productName ?? row.description ?? row.productNameSnapshot;
    const requestedSpecification = own(row, "specification") ? row.specification : row.specificationSnapshot;
    const requestedUnit = row.unit ?? row.unitSnapshot;
    const name = quotationText(requestedName ?? product?.name, `第 ${index + 1} 行品名`, 200, true);
    const specification = quotationText(requestedSpecification ?? product?.specification, `第 ${index + 1} 行规格`, 500);
    const unit = quotationText(requestedUnit ?? product?.unit, `第 ${index + 1} 行单位`, 50, true);
    const quantity = quotationDecimal(row.quantity, `第 ${index + 1} 行数量`, {
      positive: true,
      scale: 4,
      integerDigits: 14,
    });
    const unitPrice = quotationDecimal(row.unitPrice, `第 ${index + 1} 行单价`, {
      scale: 6,
      integerDigits: 12,
    });
    const fingerprint = productFingerprint(customerId, name, specification, unit);
    const identityKey = productIdentityKey(customerId, name, specification, unit);
    const amount = quotationDecimal(
      quotationLineAmount(quantity, unitPrice).toString(),
      `第 ${index + 1} 行金额`,
      { scale: 2, integerDigits: 16 },
    );
    return {
      lineNumber: index + 1,
      requestedCustomerProductId: customerProductId,
      identityKey,
      productFingerprintSnapshot: fingerprint,
      productNameSnapshot: name,
      specificationSnapshot: specification || null,
      unitSnapshot: unit,
      currencySnapshot: currency,
      quantity,
      unitPrice,
      amount,
      remark: quotationText(row.remark, `第 ${index + 1} 行备注`, 1000) || null,
    };
  });

  const linkedProductByFingerprint = new Map<string, (typeof products)[number]>();
  const result: Array<Omit<(typeof normalizedItems)[number], "requestedCustomerProductId" | "identityKey"> & { customerProductId: string }> = [];
  for (const item of normalizedItems) {
    const requestedProduct = item.requestedCustomerProductId
      ? productById.get(item.requestedCustomerProductId)
      : null;
    const requestedMatches = requestedProduct
      && productIdentityKey(customerId, requestedProduct.name, requestedProduct.specification, requestedProduct.unit) === item.identityKey;
    let linkedProduct = linkedProductByFingerprint.get(item.productFingerprintSnapshot)
      || (requestedMatches ? requestedProduct : null)
      || productByIdentity.get(item.identityKey);
    if (!linkedProduct) {
      const before = productByFingerprint.get(item.productFingerprintSnapshot) || null;
      if (before && !before.deletedAt) {
        linkedProduct = before;
      } else if (before) {
        linkedProduct = await client.customerProduct.update({
          where: { id: before.id },
          data: { deletedAt: null, updatedById: actorId },
        });
        await writeAudit(request, { id: actorId }, "报价自动恢复客户产品", "customer_products", linkedProduct.id, before, linkedProduct, client);
      } else {
        linkedProduct = await client.customerProduct.upsert({
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
        await writeAudit(request, { id: actorId }, "报价自动收录客户产品", "customer_products", linkedProduct.id, null, linkedProduct, client);
      }
      linkedProductByFingerprint.set(item.productFingerprintSnapshot, linkedProduct);
      productByIdentity.set(item.identityKey, linkedProduct);
    }
    if (linkedProduct.deletedAt) {
      const before = linkedProduct;
      linkedProduct = await client.customerProduct.update({
        where: { id: before.id },
        data: { deletedAt: null, updatedById: actorId },
      });
      await writeAudit(request, { id: actorId }, "报价自动恢复客户产品", "customer_products", linkedProduct.id, before, linkedProduct, client);
    }
    linkedProductByFingerprint.set(item.productFingerprintSnapshot, linkedProduct);
    const {
      requestedCustomerProductId: _requestedCustomerProductId,
      identityKey: _identityKey,
      ...snapshot
    } = item;
    result.push({ ...snapshot, customerProductId: linkedProduct.id });
  }
  return result;
}

export async function buildQuotationVersionData(
  client: QuotationClient,
  input: LooseRecord,
  customer: QuotationCustomerSnapshot,
  actorId: string,
  request: AuditRequest,
  current: LooseRecord | null = null,
) {
  const currency = quotationText(
    own(input, "currency") ? input.currency : currentValue(current, "currency", customer.defaultCurrency || "USD"),
    "币种",
    10,
    true,
  ).toUpperCase();
  if (!CURRENCIES.includes(currency)) throw codedError("请选择有效币种", 400, "QUOTATION_CURRENCY_INVALID");
  const quoteDate = quotationDate(
    own(input, "quoteDate") ? input.quoteDate : undefined,
    "报价日期",
    current?.quoteDate instanceof Date ? current.quoteDate : todayInChina(),
  );
  if (!quoteDate) throw codedError("报价日期不能为空", 400, "QUOTATION_DATE_REQUIRED");
  const validUntil = quotationDate(
    own(input, "validUntil") ? input.validUntil : undefined,
    "报价有效期",
    current?.validUntil instanceof Date ? current.validUntil : null,
  );
  if (validUntil && validUntil < quoteDate) {
    throw codedError("报价有效期不能早于报价日期", 400, "QUOTATION_VALID_UNTIL_INVALID");
  }
  const exchangeRate = quotationDecimal(
    own(input, "exchangeRate") ? input.exchangeRate : currentValue(current, "exchangeRate", "1"),
    "汇率",
    { positive: true, scale: 6, integerDigits: 12 },
  );
  const rawItems = own(input, "items")
    ? input.items
    : (Array.isArray(current?.items) ? current.items.map(itemInputFromSnapshot) : []);
  const items = await quotationItemsData(client, customer.id, currency, rawItems, actorId, request);
  const subtotal = quotationDecimal(
    items.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0)).toDecimalPlaces(2).toString(),
    "报价小计",
    { scale: 2, integerDigits: 16 },
  );
  const discountAmount = quotationDecimal(
    own(input, "discountAmount") ? input.discountAmount : currentValue(current, "discountAmount", "0"),
    "优惠金额",
    { scale: 2, integerDigits: 16 },
  );
  // Tax is intentionally not part of the quotation product. Keep the legacy
  // database column at zero so older rows remain readable without allowing a
  // hidden API field (or an old version) to affect a new quotation version.
  const taxAmount = new Prisma.Decimal(0);
  if (discountAmount.gt(subtotal)) {
    throw codedError("优惠金额不能大于报价小计", 400, "QUOTATION_DISCOUNT_INVALID");
  }
  const totalAmount = quotationDecimal(
    subtotal.sub(discountAmount).toDecimalPlaces(2).toString(),
    "报价总额",
    { scale: 2, integerDigits: 16 },
  );
  return {
    customerNameSnapshot: customer.name,
    customerShortNameSnapshot: customer.shortName || null,
    countrySnapshot: customer.country || null,
    contactPersonSnapshot: customer.contactPerson || null,
    contactEmailSnapshot: customer.contactEmail || null,
    contactPhoneSnapshot: customer.contactPhone || null,
    quoteDate,
    validUntil,
    currency,
    exchangeRate,
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount,
    tradeTerm: quotationText(own(input, "tradeTerm") ? input.tradeTerm : currentValue(current, "tradeTerm", "FOB"), "贸易条款", 50) || null,
    paymentTerm: quotationText(own(input, "paymentTerm") ? input.paymentTerm : currentValue(current, "paymentTerm", ""), "付款条款", 500) || null,
    leadTimeDays: nullableInteger(
      own(input, "leadTimeDays") ? input.leadTimeDays : undefined,
      "预计交期",
      current?.leadTimeDays === null || current?.leadTimeDays === undefined ? null : Number(current.leadTimeDays),
    ),
    remark: quotationText(own(input, "remark") ? input.remark : currentValue(current, "remark", ""), "备注", 5000) || null,
    createdById: actorId,
    items,
  };
}
