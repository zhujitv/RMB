import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { Prisma } from "../lib/generated/prisma/client.js";
import {
  assertExpectedQuotationVersion,
  assertQuotationCustomerImmutable,
  decimalIntegerDigits,
  productFingerprint,
  productIdentityKey,
  quotationLineAmount,
  quotationOwnershipWhere,
} from "../lib/platform/quotation-calculations.ts";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const { assertQuotationEmailRecipientsAuthorized } = await jiti.import<
  typeof import("../lib/platform/quotation-email-delivery-rules.ts")
>("../lib/platform/quotation-email-delivery-rules.ts");

const schema = readPrismaSchemaSource();
const migration = readFileSync("prisma/migrations/20260809110000_sales_quotation_foundation/migration.sql", "utf8");
const quotationService = [
  "lib/platform/quotation-service.ts",
  "lib/platform/quotation-query-service.ts",
  "lib/platform/quotation-version-builder.ts",
  "lib/platform/quotation-calculations.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
const quotationMutationService = readFileSync("lib/platform/quotation-service.ts", "utf8");
const customerAccessService = readFileSync("lib/platform/masters-access.ts", "utf8");
const permissionData = readFileSync("lib/platform/shared-permission-data.ts", "utf8");
const customerProductService = readFileSync("lib/platform/quotation-customer-products.ts", "utf8");
const quotationEmailService = readFileSync("lib/platform/quotation-email-service.ts", "utf8");
const quotationEmailClaim = readFileSync("lib/platform/quotation-email-delivery-claim.ts", "utf8");
const quotationEmailRecipients = readFileSync("lib/platform/quotation-email-recipients.ts", "utf8");
const listRoute = readFileSync("app/api/quotations/route.ts", "utf8");
const detailRoute = readFileSync("app/api/quotations/[id]/route.ts", "utf8");
const productRoute = readFileSync("app/api/customer-products/route.ts", "utf8");

test("quotation schema keeps customer products deduplicated and quote snapshots versioned", () => {
  assert.match(schema, /model CustomerProduct[\s\S]*@@unique\(\[customerId, fingerprint\]\)/);
  assert.match(schema, /model SalesQuotation\b[\s\S]*currentVersionNumber\s+Int/);
  assert.match(schema, /model SalesQuotationVersion[\s\S]*@@unique\(\[quotationId, versionNumber\]\)/);
  assert.match(schema, /sealedAt\s+DateTime\?\s+@map\("sealed_at"\)/);
  assert.match(schema, /model SalesQuotationItem[\s\S]*productNameSnapshot\s+String/);
  assert.match(schema, /quantity\s+Decimal\s+@db\.Decimal\(18, 4\)/);
  assert.match(schema, /unitPrice\s+Decimal\s+@map\("unit_price"\) @db\.Decimal\(18, 6\)/);
  assert.match(schema, /amount\s+Decimal\s+@db\.Decimal\(18, 2\)/);
  assert.match(migration, /sales_quotation_versions_immutable/);
  assert.match(migration, /sales_quotation_items_immutable/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE ON "sales_quotation_items"/);
  assert.match(migration, /version_sealed_at/);
  assert.match(migration, /snapshots are immutable/);
});

test("product fingerprints normalize customer, name, specification, and unit", () => {
  const normalized = productFingerprint("customer-1", " Panel  A ", " 100 x 20 ", "PCS");
  const equivalent = productFingerprint("customer-1", "ＰＡＮＥＬ A", "100   x 20", "pcs");
  const otherCustomer = productFingerprint("customer-2", "Panel A", "100 x 20", "pcs");
  assert.equal(normalized, equivalent);
  assert.notEqual(normalized, otherCustomer);
  assert.match(normalized, /^[a-f0-9]{64}$/);
});

test("product identity treats split and already-combined descriptions as the same visible product", () => {
  const split = productIdentityKey("customer-1", "Universal panel WPC", "24*140*2900 mm", "PCS");
  const combined = productIdentityKey("customer-1", "Universal panel WPC (24*140*2900 mm)", "", "pcs");
  assert.equal(split, combined);
  assert.notEqual(split, productIdentityKey("customer-1", "Universal panel WPC (24*140*2900 mm)", "", "M2"));
});

test("server computes line amounts from Decimal quantity and unit price", () => {
  const amount = quotationLineAmount(new Prisma.Decimal("3.1250"), new Prisma.Decimal("12.345600"));
  assert.equal(amount.toString(), "38.58");
  assert.match(quotationService, /quotationLineAmount\(quantity, unitPrice\)\.toString\(\)/);
  assert.doesNotMatch(quotationService, /amount:\s*row\.amount/);
  assert.equal(decimalIntegerDigits(new Prisma.Decimal("9999999999999999.99")), 16);
  assert.equal(decimalIntegerDigits(new Prisma.Decimal("10000000000000000.00")), 17);
});

test("new quotation versions ignore tax and calculate totals as subtotal minus discount", () => {
  const versionBuilder = readFileSync("lib/platform/quotation-version-builder.ts", "utf8");
  const valuesSource = readFileSync("lib/platform/quotation-values.ts", "utf8");
  assert.match(versionBuilder, /const taxAmount = new Prisma\.Decimal\(0\)/);
  assert.match(versionBuilder, /subtotal\.sub\(discountAmount\)\.toDecimalPlaces\(2\)/);
  assert.doesNotMatch(versionBuilder, /own\(input, "taxAmount"\)/);
  assert.doesNotMatch(versionBuilder, /currentValue\(current, "taxAmount"/);
  assert.doesNotMatch(valuesSource, /taxAmount: decimalText\(version\.taxAmount\)/);
});

test("quotation access and stale mutation guards behave without a database", () => {
  assert.deepEqual(quotationOwnershipWhere("ALL", "admin-1"), {});
  assert.deepEqual(quotationOwnershipWhere("OWN", "sales-1"), { salespersonUserId: "sales-1" });
  assert.deepEqual(quotationOwnershipWhere("NONE", "sales-1"), { id: "__no_quotation_access__" });
  assert.deepEqual(quotationOwnershipWhere("OWN", ""), { id: "__no_quotation_access__" });
  assert.equal(assertExpectedQuotationVersion({ expectedVersionNumber: 2 }, 2), 2);
  assert.throws(
    () => assertExpectedQuotationVersion({}, 2),
    (error: unknown) => (error as { status?: number; code?: string }).status === 409
      && (error as { code?: string }).code === "QUOTATION_VERSION_CONFLICT",
  );
  assert.throws(
    () => assertExpectedQuotationVersion({ expectedVersionNumber: 1 }, 2),
    (error: unknown) => (error as { status?: number; code?: string }).status === 409
      && (error as { code?: string }).code === "QUOTATION_VERSION_CONFLICT",
  );
  assert.throws(
    () => assertQuotationCustomerImmutable("customer-2", "customer-1"),
    (error: unknown) => (error as { status?: number; code?: string }).status === 409
      && (error as { code?: string }).code === "QUOTATION_CUSTOMER_IMMUTABLE",
  );
  assert.doesNotThrow(() => assertQuotationCustomerImmutable("customer-1", "customer-1"));
});

test("manual quote items atomically reuse or create the final customer product fingerprint", () => {
  assert.match(quotationService, /customerId_fingerprint/);
  assert.match(quotationService, /client\.customerProduct\.upsert/);
  assert.match(quotationService, /productFingerprintSnapshot: fingerprint/);
  assert.match(quotationService, /customerProductId: linkedProduct\.id/);
  assert.match(quotationService, /报价自动收录客户产品/);
  assert.match(quotationService, /requestedName[\s\S]*product\?\.name/);
  assert.match(customerProductService, /CUSTOMER_PRODUCT_DUPLICATE/);
  assert.match(quotationService, /productIdentityKey/);
});

test("customer product suggestions derive the latest active quote price for the requested currency", () => {
  const valuesSource = readFileSync("lib/platform/quotation-values.ts", "utf8");
  assert.match(customerProductService, /query\.get\("currency"\)/);
  assert.match(customerProductService, /currencySnapshot: currency/);
  assert.match(customerProductService, /quotation: \{ status: \{ in: \["DRAFT", "SENT", "ACCEPTED", "REJECTED"\] \} \}/);
  assert.match(customerProductService, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(customerProductService, /take: 1/);
  assert.match(valuesSource, /lastUnitPrice:/);
  assert.match(valuesSource, /lastCurrency:/);
  assert.match(valuesSource, /lastQuotedAt:/);

});

test("quotation access is permission checked and customer scoped", () => {
  assert.match(quotationService, /assertRead\(actor, "quotations"\)/);
  assert.match(quotationService, /assertWrite\(actor, "quotations"\)/);
  assert.match(quotationService, /quotationOwnershipWhere\(permissions\.dataScope, actor\?\.id\)/);
  assert.match(quotationService, /assertCustomerScope\(actor, customerId, tx\)/);
  assert.match(customerProductService, /assertCustomerScope\(actor, customerId\)/);
});

test("quotation writes recheck the current customer scope after historical quote access", () => {
  const updateSource = quotationMutationService.match(
    /export async function updateQuotation[\s\S]*?(?=\nexport async function voidQuotation)/,
  )?.[0] || "";
  const voidSource = quotationMutationService.match(
    /export async function voidQuotation[\s\S]*$/,
  )?.[0] || "";

  assert.match(
    updateSource,
    /loadQuotation\(id, actor, tx\)[\s\S]*assertCustomerScope\(actor, before\.customerId, tx\)[\s\S]*buildQuotationVersionData/,
  );
  assert.match(
    voidSource,
    /loadQuotation\(id, actor, tx\)[\s\S]*assertCustomerScope\(actor, before\.customerId, tx\)[\s\S]*assertExpectedQuotationVersion\(body, before\.currentVersionNumber\)[\s\S]*salesQuotation\.updateMany/,
  );
  assert.equal(
    quotationMutationService.match(/assertCustomerScope\(actor, before\.customerId, tx\)/g)?.length,
    2,
  );
});

test("quotation email recipients must come from administrator-managed customer addresses", () => {
  assert.doesNotThrow(() => assertQuotationEmailRecipientsAuthorized(
    ["buyer@example.com"],
    ["finance@example.com"],
    ["buyer@example.com", "finance@example.com"],
  ));
  assert.throws(
    () => assertQuotationEmailRecipientsAuthorized(
      ["outside@example.net"],
      [],
      ["buyer@example.com"],
    ),
    (error: unknown) => (error as { status?: number; code?: string }).status === 403
      && (error as { code?: string }).code === "QUOTATION_EMAIL_RECIPIENT_NOT_AUTHORIZED",
  );
  assert.throws(
    () => assertQuotationEmailRecipientsAuthorized(["buyer@example.com"], [], []),
    (error: unknown) => (error as { status?: number; code?: string }).status === 409
      && (error as { code?: string }).code === "QUOTATION_EMAIL_APPROVED_RECIPIENT_REQUIRED",
  );
  assert.match(
    quotationEmailService,
    /assertQuotationCustomerEmailRecipients\([\s\S]*versionContactEmail: version\.contactEmailSnapshot[\s\S]*shippingDocsEmails: quotation\.customer\.shippingDocsEmails[\s\S]*shippingDocsCcEmails: quotation\.customer\.shippingDocsCcEmails/,
  );
  assert.match(
    quotationEmailClaim,
    /validateCurrentSendTarget[\s\S]*assertQuotationCustomerEmailRecipients\([\s\S]*versionContactEmail: version\.contactEmailSnapshot[\s\S]*shippingDocsEmails: quotation\.customer\.shippingDocsEmails/,
  );
  assert.match(quotationEmailRecipients, /assertQuotationEmailRecipientsAuthorized\([\s\S]*uniqueEmails\(/);
  assert.match(
    quotationEmailClaim,
    /lockQuotationEmailActor[\s\S]*isActive: true[\s\S]*approvalStatus: "APPROVED"[\s\S]*canWrite\(actor, "quotations"\)[\s\S]*canWrite\(actor, "customerCommunication"\)/,
  );
  assert.match(
    quotationEmailClaim,
    /salesQuotation\.findFirst\([\s\S]*quotationAccessWhere\(actor\)/,
  );
});

test("current customer scope rejects a former salesperson while administrators retain global access", () => {
  assert.match(
    customerAccessService,
    /!canViewAllCustomers\(actor\) && customer\.salespersonUserId !== actorId\(actor\)[\s\S]*CUSTOMER_PERMISSION_DENIED/,
  );
  assert.match(permissionData, /CUSTOMER_VIEW_ALL_ROLES\s*=\s*\["管理员"\]/);
});

test("draft updates append versions, soft void, and write audit records", () => {
  assert.match(quotationService, /nextVersionNumber = before\.currentVersionNumber \+ 1/);
  assert.match(quotationService, /expectedVersionNumber/);
  assert.match(quotationService, /QUOTATION_CUSTOMER_IMMUTABLE/);
  assert.match(quotationService, /salesQuotationVersion\.create/);
  assert.match(quotationService, /currentVersionNumber: nextVersionNumber/);
  assert.match(quotationService, /status: "VOIDED"/);
  assert.match(quotationService, /voidedAt: new Date\(\)/);
  assert.match(quotationService, /writeAudit\(/);
  assert.doesNotMatch(quotationService, /salesQuotation\.delete/);
  assert.match(quotationService, /salesQuotationVersion\.update\(\{ where: \{ id: version\.id \}, data: \{ sealedAt: new Date\(\) \} \}\)/);
});

test("quotation serializers keep Decimal snapshots as JSON-safe strings", () => {
  const valuesSource = readFileSync("lib/platform/quotation-values.ts", "utf8");
  assert.match(valuesSource, /Prisma\.Decimal\.isDecimal\(value\)/);
  assert.match(valuesSource, /return value\.toString\(\)/);
  assert.match(valuesSource, /const totals = \{[\s\S]*subtotal: decimalText\(version\.subtotal\)/);
  assert.match(valuesSource, /lineTotal: amount/);
  assert.match(valuesSource, /sellerSnapshotReady/);
});

test("quotation APIs expose paginated compatibility and detail response fields", () => {
  assert.match(listRoute, /data, quotations: data\.rows/);
  assert.match(listRoute, /status: 201/);
  assert.match(detailRoute, /data: quotation, quotation/);
  assert.match(detailRoute, /parseJsonBody\(request, \{ allowEmpty: true \}\)/);
  assert.match(productRoute, /data, products: data\.rows/);
  assert.match(quotationService, /salesperson: \{ is: \{ name: \{ contains: keyword/);
});
