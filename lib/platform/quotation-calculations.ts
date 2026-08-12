import crypto from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";

export function normalizeProductPart(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function productVisibleDescription(name: unknown, specification: unknown) {
  const normalizedName = String(name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  const normalizedSpecification = String(specification ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalizedSpecification) return normalizedName;
  if (!normalizedName) return normalizedSpecification;
  if (normalizedName.toLocaleLowerCase("en-US").includes(normalizedSpecification.toLocaleLowerCase("en-US"))) {
    return normalizedName;
  }
  if (/^[【[(（]/.test(normalizedSpecification)) return `${normalizedName} ${normalizedSpecification}`;
  return `${normalizedName} (${normalizedSpecification})`;
}

export function productIdentityKey(customerId: unknown, name: unknown, specification: unknown, unit: unknown) {
  return [customerId, productVisibleDescription(name, specification), unit]
    .map(normalizeProductPart)
    .join("\u001f");
}

export function productFingerprint(customerId: unknown, name: unknown, specification: unknown, unit: unknown) {
  const normalized = [customerId, name, specification, unit].map(normalizeProductPart).join("\u001f");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function quotationLineAmount(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal) {
  return quantity.mul(unitPrice).toDecimalPlaces(2);
}

export function decimalIntegerDigits(value: Prisma.Decimal) {
  return value.trunc().abs().toFixed(0).replace(/^0+/, "").length || 1;
}

export function quotationOwnershipWhere(dataScope: unknown, actorId: unknown): Prisma.SalesQuotationWhereInput {
  if (dataScope === "ALL") return {};
  const ownerId = String(actorId || "").trim();
  if (dataScope === "OWN" && ownerId) return { salespersonUserId: ownerId };
  return { id: "__no_quotation_access__" };
}

function quotationConflict(message: string, code: string) {
  const error = new Error(message) as Error & { status: number; code: string; expose: boolean };
  error.status = 409;
  error.code = code;
  error.expose = true;
  return error;
}

export function assertExpectedQuotationVersion(input: Record<string, unknown>, currentVersionNumber: number) {
  if (!Object.prototype.hasOwnProperty.call(input, "expectedVersionNumber")) {
    throw quotationConflict("缺少报价版本号，请刷新后重试", "QUOTATION_VERSION_CONFLICT");
  }
  const expectedVersionNumber = Number(input.expectedVersionNumber);
  if (!Number.isSafeInteger(expectedVersionNumber) || expectedVersionNumber !== currentVersionNumber) {
    throw quotationConflict("报价已被其他用户更新，请刷新后重试", "QUOTATION_VERSION_CONFLICT");
  }
  return expectedVersionNumber;
}

export function assertQuotationCustomerImmutable(requestedCustomerId: string, currentCustomerId: string) {
  if (requestedCustomerId !== currentCustomerId) {
    throw quotationConflict("报价创建后不能变更客户，请新建报价", "QUOTATION_CUSTOMER_IMMUTABLE");
  }
}
