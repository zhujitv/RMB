import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rolePermissionSnapshot } from "../lib/platform/shared-permission-data.ts";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function assertApiRouteUsesUnifiedAuth(path: string) {
  const route = source(path);
  assert.match(route, /\brequireApiActor\b|\bwithApiAuth\b|\bwithApiRead\b|\bwithApiWrite\b|\breportGetHandler\b/, `${path} must use a unified auth wrapper`);
  assert.doesNotMatch(route, /\bgetActor\b/, `${path} must not call getActor directly`);
}

const orderAccess = source("lib/platform/order-access.ts");
const ordersService = source("lib/platform/orders-module.ts");
const paymentsService = source("lib/platform/payments-module.ts");
const taxRefundService = source("lib/platform/tax-refunds.ts");
const domesticLogisticsService = source("lib/platform/domestic-logistics-api.ts");
const mastersAccess = source("lib/platform/masters-access.ts");
const logisticsExpenseQueries = source("lib/platform/logistics-expense-queries.ts");
const logisticsExpenseAccess = source("lib/platform/logistics-expense-access.ts");
const shipsgoTracking = source("lib/platform/shipsgo-tracking.ts");
const supplierDocumentService = source("lib/platform/supplier-document-requests.ts");
const supplierDocumentModule = source("app/modules/SupplierDocumentsModule.tsx");
const loginRoute = source("app/api/auth/login/route.ts");
const sharedAuth = source("lib/platform/shared-auth.ts");
const workspaceShell = source("app/WorkspaceShell.tsx");

test("E2E permission: salesperson data stays scoped to own customers across orders payments costs reports and tax refund", () => {
  const salesperson = rolePermissionSnapshot("业务员");
  assert.equal(salesperson.dataScope, "OWN");
  assert.equal(salesperson.reads.orders, true);
  assert.equal(salesperson.reads.payments, true);
  assert.equal(salesperson.reads.costs, true);
  assert.equal(salesperson.reads.taxRefund, true);
  assert.equal(salesperson.reads.reports, true);
  assert.equal(salesperson.reads.commissions, false);
  assert.equal(salesperson.writes.payments, false);
  assert.equal(salesperson.writes.taxRefund, false);

  for (const route of [
    "app/api/orders/route.ts",
    "app/api/payments/route.ts",
    "app/api/costs/route.ts",
    "app/api/reports/route.ts",
    "app/api/tax-refunds/route.ts",
  ]) {
    assertApiRouteUsesUnifiedAuth(route);
  }

  assert.match(orderAccess, /if \(scope === "OWN"\)[\s\S]*customer:\s*\{\s*is:\s*\{\s*salespersonUserId: currentActorId/);
  assert.match(orderAccess, /if \(scope === "OWN"\) return order\?\.customer\?\.salespersonUserId === actorId\(actor\)/);
  assert.match(ordersService, /orderAccessWhere\(actor\)/);
  assert.match(ordersService, /assertCustomerScope\(actor, requireText\(inputData\.customerId, "客户"\)\)/);
  assert.match(ordersService, /resolveSalespersonUserId\(inputData, actor, customer, before\)/);
  assert.match(paymentsService, /assertRead\(actor, "payments"\)/);
  assert.match(paymentsService, /const accessWhere = orderAccessWhere\(actor\)/);
  assert.match(taxRefundService, /orderAccessWhere\(actor\)/);
});

test("E2E permission: logistics supplier only sees assigned logistics work and its own bills", () => {
  const supplier = rolePermissionSnapshot("物流供应商");
  assert.equal(supplier.dataScope, "OWN");
  assert.equal(supplier.reads.domesticLogistics, true);
  assert.equal(supplier.writes.domesticLogistics, true);
  assert.equal(supplier.writes.logistics, true);
  assert.equal(supplier.reads.payments, false);
  assert.equal(supplier.reads.costs, false);
  assert.equal(supplier.reads.supplierDocuments, false);

  for (const route of [
    "app/api/domestic-logistics/route.ts",
    "app/api/logistics-costs/route.ts",
    "app/api/logistics-costs/review/route.ts",
    "app/api/shipsgo/ocean-trackings/control-tower/route.ts",
  ]) {
    assertApiRouteUsesUnifiedAuth(route);
  }

  assert.match(mastersAccess, /export function isExternalLogisticsSupplierAccount/);
  assert.match(mastersAccess, /return \(order\?\.logisticsSuppliers \|\| \[\]\)\.some\(\(row\) => row\?\.supplierId === actor\.supplierId\)/);
  assert.match(domesticLogisticsService, /isExternalLogisticsSupplierAccount\(actor\)[\s\S]*logisticsSuppliers:\s*\{\s*some:\s*\{\s*supplierId\s*\}/);
  assert.match(logisticsExpenseQueries, /if \(\[LOGISTICS_OPERATOR_ROLE, LEGACY_LOGISTICS_OPERATOR_ROLE\]\.includes\(role\)\) return supplierId \? \{ supplierId \} : \{ id: "__no_supplier_bound__" \}/);
  assert.match(logisticsExpenseAccess, /if \(actor\.supplierId\) return \{ supplierId: actor\.supplierId \}/);
  assert.match(shipsgoTracking, /canAccessDomesticLogisticsOrder\(actor, order\)/);
});

test("E2E permission: product supplier portal is supplier-bound and never exposes customer identity", () => {
  const productSupplier = rolePermissionSnapshot("产品供应商");
  assert.deepEqual(productSupplier.menus, ["supplierDocuments", "manual"]);
  assert.equal(productSupplier.dataScope, "OWN");
  assert.equal(productSupplier.reads.supplierDocuments, true);
  assert.equal(productSupplier.writes.supplierDocuments, true);
  assert.equal(productSupplier.reads.orders, false);
  assert.equal(productSupplier.reads.customers, false);
  assert.equal(productSupplier.reads.domesticLogistics, false);
  assert.equal(productSupplier.reads.costs, false);

  for (const route of [
    "app/api/supplier-document-requests/route.ts",
    "app/api/supplier-document-requests/[id]/route.ts",
    "app/api/supplier-document-requests/[id]/documents/route.ts",
    "app/api/supplier-document-requests/[id]/template/route.ts",
  ]) {
    assertApiRouteUsesUnifiedAuth(route);
  }

  assert.match(supplierDocumentService, /assertRead\(actor, "supplierDocuments"\)/);
  assert.match(supplierDocumentService, /assertWrite\(actor, "supplierDocuments"\)/);
  assert.match(supplierDocumentService, /supplierId: actor\?\.supplierId \|\| "__no_supplier_bound__"/);
  assert.match(supplierDocumentService, /supplier:\s*\{\s*allowFactoryDocumentUpload: true, status: "启用", deletedAt: null\s*\}/);
  assert.doesNotMatch(supplierDocumentService, /customerName|customerFullName|customerShortName/);
  assert.doesNotMatch(supplierDocumentModule, /customerName|customerFullName|customerShortName|客户简称|客户全称/);
});

test("E2E permission: finance can read financial modules but cannot mutate orders users or supplier records", () => {
  const finance = rolePermissionSnapshot("财务");
  assert.equal(finance.dataScope, "ALL");
  assert.equal(finance.reads.payments, true);
  assert.equal(finance.reads.costs, true);
  assert.equal(finance.reads.taxRefund, true);
  assert.equal(finance.reads.commissions, true);
  assert.equal(finance.writes.payments, true);
  assert.equal(finance.writes.taxRefund, true);
  assert.equal(finance.writes.orders, false);
  assert.equal(finance.writes.users, false);
  assert.equal(finance.writes.suppliers, false);
  assert.equal(finance.writes.settings, false);

  for (const route of [
    "app/api/payments/route.ts",
    "app/api/tax-refunds/[orderId]/route.ts",
    "app/api/users/route.ts",
    "app/api/settings/users/route.ts",
    "app/api/suppliers/route.ts",
  ]) {
    assertApiRouteUsesUnifiedAuth(route);
  }

  assert.match(ordersService, /export async function saveOrder[\s\S]*assertWrite\(actor, "orders"\)/);
  assert.match(source("lib/platform/shared-users.ts"), /assertWrite\(actor, "users"\)/);
  assert.match(source("lib/platform/supplier-masters.ts"), /assertWrite\(actor, "suppliers"\)/);
  assert.match(paymentsService, /assertRead\(actor, "payments"\)/);
});

test("E2E permission: unverified email and weak-password accounts are stopped before business APIs", () => {
  assert.match(loginRoute, /user\.emailVerified === false[\s\S]*EMAIL_NOT_VERIFIED/);
  assert.match(loginRoute, /approvalStatus === "PENDING"[\s\S]*USER_PENDING_APPROVAL/);
  assert.match(loginRoute, /!user\.passwordPolicyPassed && !currentPasswordMeetsPolicy[\s\S]*mustChangePassword: true/);
  assert.match(sharedAuth, /session\.user\.emailVerified === false[\s\S]*revokeEmailUnverifiedSessions[\s\S]*请先完成邮箱验证/);
  assert.match(sharedAuth, /session\.user\.passwordPolicyPassed === false && !allowPasswordChangeRequired[\s\S]*PASSWORD_CHANGE_REQUIRED/);
  assert.match(workspaceShell, /payload\.user\.mustChangePassword \|\| payload\.user\.passwordPolicyPassed === false/);

  for (const route of [
    "app/api/orders/route.ts",
    "app/api/payments/route.ts",
    "app/api/logistics-costs/route.ts",
    "app/api/tax-refunds/route.ts",
    "app/api/supplier-document-requests/route.ts",
  ]) {
    assertApiRouteUsesUnifiedAuth(route);
  }
});
