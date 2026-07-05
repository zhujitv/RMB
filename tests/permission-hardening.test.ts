import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { effectivePermissions, rolePermissionSnapshot } from "../lib/platform/shared-permission-data.ts";
import {
  readOrderDocumentsSource,
  readReportServiceSource,
  readReportsModuleSource,
  readSharedAuthSource,
  readSharedConstantsSource,
  readTaxRefundModuleSource,
  readWorkspaceShellSource,
} from "./source-helpers.ts";

const legacyProductSupplierRole = `产品供应商${"账号"}`;
const legacyProductSupplierMenuPattern = new RegExp(`${legacyProductSupplierRole}: \\["supplierDocuments", "manual"\\]`);
const backend = [
  readSharedConstantsSource(),
  readFileSync("lib/platform/shared-permission-data.ts", "utf8"),
  readFileSync("lib/platform/shared-access.ts", "utf8"),
  readFileSync("lib/platform/profit-overview.ts", "utf8"),
].join("\n");
const workspaceShell = readWorkspaceShellSource();
const authMeRoute = readFileSync("app/api/auth/me/route.ts", "utf8");
const menuFile = readFileSync("app/menu.ts", "utf8");
const ledgerRoute = readFileSync("app/api/ledger/route.ts", "utf8");
const overviewRoute = readFileSync("app/api/overview/route.ts", "utf8");
const sharedAuth = readSharedAuthSource();
const reportService = readReportServiceSource();
const reportsModule = readReportsModuleSource();
const taxRefundModule = readTaxRefundModuleSource();
const orderDocumentsService = readOrderDocumentsSource();
const fileDeletePolicy = readFileSync("lib/platform/file-delete-policy.ts", "utf8");

const SECURITY_ROLE_MATRIX = [
  {
    role: "管理员",
    dataScope: "ALL",
    allowedReads: ["users", "customers", "suppliers", "orders", "payments", "costs", "customerCommunication", "taxRefund", "commissions", "reports", "settings", "auditLogs"],
    allowedWrites: ["users", "customers", "orders", "payments", "costs", "customerCommunication", "taxRefund", "commissions", "suppliers", "settings"],
    deniedReads: [],
    deniedWrites: [],
  },
  {
    role: "业务员",
    dataScope: "OWN",
    allowedReads: ["customers", "orders", "payments", "costs", "domesticLogistics", "customerCommunication", "documents", "taxRefund", "reports"],
    allowedWrites: ["orders", "costs", "documents", "domesticLogistics", "customerCommunication"],
    deniedReads: ["users", "suppliers", "settings", "auditLogs", "commissions"],
    deniedWrites: ["users", "customers", "payments", "taxRefund", "commissions", "suppliers", "settings"],
  },
  {
    role: "财务",
    dataScope: "ALL",
    allowedReads: ["orders", "payments", "costs", "documents", "taxRefund", "commissions", "reports"],
    allowedWrites: ["payments", "documents", "taxRefund", "commissions", "exchangeRates"],
    deniedReads: ["users", "customers", "suppliers", "domesticLogistics", "customerCommunication", "settings", "auditLogs"],
    deniedWrites: ["users", "customers", "orders", "customerCommunication", "suppliers", "settings"],
  },
  {
    role: "物流供应商",
    dataScope: "OWN",
    allowedReads: ["domesticLogistics", "customerCommunication", "documents"],
    allowedWrites: ["logistics", "domesticLogistics", "documents"],
    deniedReads: ["users", "customers", "orders", "payments", "costs", "taxRefund", "commissions", "reports", "settings"],
    deniedWrites: ["users", "customers", "orders", "payments", "costs", "customerCommunication", "taxRefund", "commissions", "suppliers", "settings"],
  },
  {
    role: "产品供应商",
    dataScope: "OWN",
    allowedReads: ["supplierDocuments"],
    allowedWrites: ["supplierDocuments"],
    deniedReads: ["users", "customers", "orders", "payments", "costs", "domesticLogistics", "customerCommunication", "documents", "taxRefund", "commissions", "reports", "settings"],
    deniedWrites: ["users", "customers", "orders", "payments", "costs", "logistics", "domesticLogistics", "customerCommunication", "documents", "taxRefund", "commissions", "suppliers", "settings"],
  },
  {
    role: "物流资料录入员",
    dataScope: "OWN",
    allowedReads: ["domesticLogistics", "customerCommunication", "documents"],
    allowedWrites: ["domesticLogistics", "documents"],
    deniedReads: ["users", "customers", "orders", "payments", "costs", "taxRefund", "commissions", "reports", "settings"],
    deniedWrites: ["users", "customers", "orders", "payments", "costs", "logistics", "customerCommunication", "taxRefund", "commissions", "suppliers", "settings"],
  },
] as const;

function roleMenuLine(source: string, role: string) {
  return source.split("\n").find((line: string) => line.includes(`${role}: [`)) || "";
}

test("fixed role menus do not expose forbidden global modules", () => {
  for (const source of [backend, menuFile]) {
    assert(!roleMenuLine(source, "业务员").includes('"dashboard"'));
    assert(!roleMenuLine(source, "业务员").includes('"profit"'));
    assert(!roleMenuLine(source, "财务").includes('"dashboard"'));
  }
  assert.match(backend, /物流供应商: \["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"\]/);
  assert.match(menuFile, /物流供应商: \["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"\]/);
  assert.match(backend, /业务员: \["orders", "payments", "costs", "domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "taxRefund", "reports", "manual"\]/);
  assert.match(menuFile, /业务员: \["orders", "payments", "costs", "domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "taxRefund", "reports", "manual"\]/);
  assert.match(backend, /物流资料录入员: \["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"\]/);
  assert.match(menuFile, /物流资料录入员: \["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"\]/);
  assert.match(backend, /export function menusWithDerivedAccess/);
  assert.match(menuFile, /function menusWithDerivedAccess/);
  assert.match(menuFile, /key: "oceanControlTower", label: "运输监控"[\s\S]*parentKey: "domesticLogistics"/);
  assert.match(workspaceShell, /activeMenu === "oceanControlTower"[\s\S]*initialView="controlTower"[\s\S]*initialControlTowerFullscreen/);
  assert.match(backend, /产品供应商: \["supplierDocuments", "manual"\]/);
  assert.match(menuFile, /产品供应商: \["supplierDocuments", "manual"\]/);
  assert.doesNotMatch(backend, legacyProductSupplierMenuPattern);
  assert.doesNotMatch(menuFile, legacyProductSupplierMenuPattern);
  assert.doesNotMatch(backend, /logisticsReview: "物流费用审核"|logisticsReview", "taxRefund"/);
  assert.doesNotMatch(menuFile, /key: "logisticsReview"|logisticsReview", "taxRefund"/);
});

test("removed viewer and cost entry roles are not exposed by role configuration", () => {
  assert.doesNotMatch(menuFile, /查看者|成本录入员/);
  assert.doesNotMatch(backend, /查看者:|成本录入员:/);
  assert.doesNotMatch(backend, /ROLES = \[[^\]]*(查看者|成本录入员)/);
  assert.doesNotMatch(backend, /READ_PERMISSIONS[\s\S]*(查看者|成本录入员)/);
  assert.doesNotMatch(backend, /WRITE_PERMISSIONS[\s\S]*(查看者|成本录入员)/);
});

test("global dashboard APIs require admin global scope before returning data", () => {
  assert.match(backend, /export function requireAdminGlobal/);
  assert.match(backend, /export async function getOverview[\s\S]*requireAdminGlobal\(actor, "无权限访问经营总览"\)/);
  assert.match(ledgerRoute, /requireAdminGlobal\(actor, "无权限访问经营总览"\)/);
  assert.match(overviewRoute, /requireAdminGlobal\(actor, "无权限访问经营总览"\)/);
});

test("profit and commission reports require financial commission read permission", () => {
  assert.match(backend, /function assertProfitAnalysisAccess\(actor(?::[^)]*)?\)[\s\S]*assertRead\(actor, "commissions"\)/);
  assert.match(backend, /commissions: \["管理员", "财务"\]/);
  assert.match(reportService, /profits: \{ label: "利润分析", area: "commissions"/);
  assert.match(reportsModule, /\{ key: "profits", label: "利润分析", area: "commissions" \}/);
  assert.match(reportsModule, /commissions: \["管理员", "财务"\]/);
});

test("role permission matrix protects financial and supplier scoped data", () => {
  const admin = rolePermissionSnapshot("管理员");
  assert.equal(admin.dataScope, "ALL");
  assert.equal(admin.reads.users, true);
  assert.equal(admin.writes.settings, true);
  assert.equal(admin.writes.commissions, true);
  assert.equal(admin.menus.includes("logisticsReview"), false);

  const salesperson = rolePermissionSnapshot("业务员");
  assert.equal(salesperson.dataScope, "OWN");
  assert.equal(salesperson.menus.includes("dashboard"), false);
  assert.equal(salesperson.menus.includes("profit"), false);
  assert.equal(salesperson.menus.includes("logisticsReview"), false);
  assert.equal(salesperson.menus.includes("logisticsFees"), true);
  assert.equal(salesperson.menus.includes("customerCommunication"), true);
  assert.equal(salesperson.menus.includes("oceanControlTower"), true);
  assert.equal(salesperson.reads.customerCommunication, true);
  assert.equal(salesperson.reads.payments, true);
  assert.equal(salesperson.reads.taxRefund, true);
  assert.equal(salesperson.reads.commissions, false);
  assert.equal(salesperson.writes.payments, false);
  assert.equal(salesperson.writes.customerCommunication, true);
  assert.equal(salesperson.writes.taxRefund, false);
  assert.equal(salesperson.writes.commissions, false);

  const finance = rolePermissionSnapshot("财务");
  assert.equal(finance.dataScope, "ALL");
  assert.equal(finance.reads.commissions, true);
  assert.equal(finance.writes.payments, true);
  assert.equal(finance.writes.taxRefund, true);
  assert.equal(finance.writes.commissions, true);
  assert.equal(finance.writes.orders, false);
  assert.equal(finance.writes.users, false);
  assert.equal(finance.menus.includes("logisticsReview"), false);
  assert.equal(finance.menus.includes("logisticsFees"), true);
  assert.equal(finance.menus.includes("customerCommunication"), false);
  assert.equal(finance.reads.customerCommunication, false);
  assert.equal(finance.writes.customerCommunication, false);

  const logisticsSupplier = rolePermissionSnapshot("物流供应商");
  assert.deepEqual(logisticsSupplier.menus, ["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"]);
  assert.equal(logisticsSupplier.menus.includes("supplierDocuments"), false);
  assert.equal(logisticsSupplier.menus.includes("logisticsReview"), false);
  assert.equal(logisticsSupplier.dataScope, "OWN");
  assert.equal(logisticsSupplier.reads.payments, false);
  assert.equal(logisticsSupplier.reads.customerCommunication, true);
  assert.equal(logisticsSupplier.reads.costs, false);
  assert.equal(logisticsSupplier.reads.commissions, false);
  assert.equal(logisticsSupplier.writes.logistics, true);
  assert.equal(logisticsSupplier.writes.domesticLogistics, true);
  assert.equal(logisticsSupplier.writes.customerCommunication, false);
  assert.equal(logisticsSupplier.writes.documents, true);
  assert.equal(logisticsSupplier.writes.supplierDocuments, false);
  assert.equal(logisticsSupplier.writes.settings, false);

  const factorySupplier = rolePermissionSnapshot("产品供应商");
  assert.deepEqual(factorySupplier.menus, ["supplierDocuments", "manual"]);
  assert.equal(factorySupplier.dataScope, "OWN");
  assert.equal(factorySupplier.reads.supplierDocuments, true);
  assert.equal(factorySupplier.reads.customerCommunication, false);
  assert.equal(factorySupplier.writes.supplierDocuments, true);
  assert.equal(factorySupplier.writes.customerCommunication, false);
  assert.equal(factorySupplier.reads.domesticLogistics, false);
  assert.equal(factorySupplier.writes.logistics, false);
  assert.equal(factorySupplier.writes.documents, false);
  assert.equal(factorySupplier.reads.payments, false);

  const legacyProductSupplier = rolePermissionSnapshot(legacyProductSupplierRole);
  assert.deepEqual(legacyProductSupplier.menus, ["supplierDocuments", "manual"]);
  assert.equal(legacyProductSupplier.reads.supplierDocuments, true);

  const legacyFactorySupplier = rolePermissionSnapshot("工厂供应商账号");
  assert.deepEqual(legacyFactorySupplier.menus, ["supplierDocuments", "manual"]);
  assert.equal(legacyFactorySupplier.reads.supplierDocuments, true);

  const logisticsClerk = rolePermissionSnapshot("物流资料录入员");
  assert.deepEqual(logisticsClerk.menus, ["domesticLogistics", "customerCommunication", "oceanControlTower", "logisticsFees", "manual"]);
  assert.equal(logisticsClerk.dataScope, "OWN");
  assert.equal(logisticsClerk.reads.domesticLogistics, true);
  assert.equal(logisticsClerk.reads.customerCommunication, true);
  assert.equal(logisticsClerk.reads.documents, true);
  assert.equal(logisticsClerk.reads.payments, false);
  assert.equal(logisticsClerk.writes.domesticLogistics, true);
  assert.equal(logisticsClerk.writes.customerCommunication, false);
  assert.equal(logisticsClerk.writes.documents, true);
  assert.equal(logisticsClerk.writes.logistics, false);

  const legacyCustomSalesperson = effectivePermissions({
    role: "业务员",
    customPermissions: {
      mode: "CUSTOM",
      menus: ["orders", "domesticLogistics", "manual"],
      reads: ["orders", "domesticLogistics"],
      writes: [],
      dataScope: "OWN",
    },
  });
  assert.deepEqual(legacyCustomSalesperson.menus, ["orders", "domesticLogistics", "oceanControlTower", "logisticsFees", "manual"]);
});

test("security role matrix is enforced from machine-readable expectations", () => {
  for (const expectation of SECURITY_ROLE_MATRIX) {
    const snapshot = rolePermissionSnapshot(expectation.role);
    assert.equal(snapshot.dataScope, expectation.dataScope, `${expectation.role} data scope`);
    for (const area of expectation.allowedReads) {
      assert.equal(snapshot.reads[area], true, `${expectation.role} should read ${area}`);
    }
    for (const area of expectation.allowedWrites) {
      assert.equal(snapshot.writes[area], true, `${expectation.role} should write ${area}`);
    }
    for (const area of expectation.deniedReads) {
      assert.equal(snapshot.reads[area], false, `${expectation.role} must not read ${area}`);
    }
    for (const area of expectation.deniedWrites) {
      assert.equal(snapshot.writes[area], false, `${expectation.role} must not write ${area}`);
    }
  }
});

test("salesperson tax refund uploads are limited to own-customer clearance documents", () => {
  const salesperson = rolePermissionSnapshot("业务员");
  assert.equal(salesperson.dataScope, "OWN");
  assert.equal(salesperson.reads.taxRefund, true);
  assert.equal(salesperson.writes.taxRefund, false);
  assert.equal(salesperson.writes.documents, true);
  assert.match(taxRefundModule, /SALESPERSON_TAX_REFUND_UPLOAD_TYPES[\s\S]*BILL_OF_LADING[\s\S]*COMMERCIAL_INVOICE[\s\S]*PACKING_LIST[\s\S]*SALES_CONTRACT/);
  assert.match(taxRefundModule, /\{ value: "COMMERCIAL_INVOICE", label: "清关发票" \}/);
  assert.match(taxRefundModule, /if \(role === "业务员"\) return SALESPERSON_TAX_REFUND_UPLOAD_TYPES\.has\(documentType\);/);
  assert.match(orderDocumentsService, /REACT_TAX_REFUND/);
  assert.match(orderDocumentsService, /SALESPERSON_TAX_REFUND_UPLOAD_DOCUMENT_TYPES\.includes\(documentType as OrderDocumentType\)/);
  assert.match(orderDocumentsService, /assertDocumentOrder\(orderId, actor, documentType\)/);
  assert.match(orderDocumentsService, /canAccessOrder\(actor, order\)/);
  assert.match(orderDocumentsService, /actorRole\(actor\) === "业务员" && canRead\(actor, "documents"\) && canAccessOrder\(actor, document\.order\)/);
  assert.match(fileDeletePolicy, /actorRole\(actor\) === "业务员" && isProtectedCustomsDocumentType\(document\.documentType\)\) return false/);
});

test("workspace auth distinguishes expired login from server-side profile failure", () => {
  assert.match(workspaceShell, /function clearClientAuthState\(\)/);
  assert.match(workspaceShell, /window\.localStorage\.removeItem\(key\)/);
  assert.match(workspaceShell, /window\.sessionStorage\.removeItem\(key\)/);
  assert.match(workspaceShell, /function withErrorCode\(message: string, code\?: string \| null\)/);
  assert.match(workspaceShell, /return message\.includes\(suffix\) \? message : `\$\{message\}\$\{suffix\}`/);
  assert.match(workspaceShell, /function authLoadErrorState\(error: unknown\): AuthState/);
  assert.match(workspaceShell, /accountStateCodes = \["EMAIL_NOT_VERIFIED", "USER_PENDING_APPROVAL", "USER_DISABLED", "AUTH_USER_NOT_FOUND"\]/);
  assert.match(workspaceShell, /error\.code === "PASSWORD_CHANGE_REQUIRED" \|\| accountStateCodes\.includes\(error\.code \|\| ""\)/);
  assert.match(workspaceShell, /message: withErrorCode\(guestMessage, errorCode\)/);
  assert.match(workspaceShell, /message: "无法读取当前用户信息"/);
  assert.doesNotMatch(workspaceShell, /message: "工作台初始化失败。"/);
  assert.match(workspaceShell, /setAuth\(nextAuth \|\| \{ status: "error", message: "无法读取当前用户信息", detail: "初始化流程未返回有效状态。"/);
});

test("auth me initialization returns classified diagnostics instead of one generic failure", () => {
  assert.match(authMeRoute, /function classifyAuthInitError/);
  assert.match(authMeRoute, /AUTH-DB-CONNECTION/);
  assert.match(authMeRoute, /AUTH-DB-SCHEMA/);
  assert.match(authMeRoute, /AUTH_USER_NOT_FOUND/);
  assert.match(authMeRoute, /AUTH_ROLE_MISSING/);
  assert.match(authMeRoute, /EMAIL_NOT_VERIFIED/);
  assert.match(authMeRoute, /USER_PENDING_APPROVAL/);
  assert.match(authMeRoute, /console\.error\("auth me failed: account info load error"/);
  assert.match(authMeRoute, /sanitizeForLog/);
  assert.match(authMeRoute, /meta: typedError\.meta/);
  assert.match(sharedAuth, /outcome = "user-not-found"/);
  assert.match(sharedAuth, /outcome = "role-missing"/);
  assert.match(sharedAuth, /outcome = "approval-pending"/);
});

test("workspace boot order enters loading before permission checks", () => {
  assert.match(workspaceShell, /const \[auth, setAuth\] = useState<AuthState>\(\{ status: "loading", message: "正在加载工作台\.\.\." \}\)/);
  assert.match(workspaceShell, /if \(auth\.status === "loading"\)(?:\s*\{\s*)?\s*return <LoadingPanel message=\{auth\.message\} \/>\s*;?(?:\s*\})?/);
  assert.match(workspaceShell, /if \(auth\.status !== "ready"\) return;/);
  assert.match(workspaceShell, /if \(!allowedMenuKeys\.has\(activeMenu\)\) setActiveMenu\("welcome"\);/);
});

test("same-origin guard allows localhost and 127 dev aliases without disabling production checks", () => {
  assert.match(sharedAuth, /function localDevelopmentAliases/);
  assert.match(sharedAuth, /\["localhost", "127\.0\.0\.1"\]\.includes\(url\.hostname\)/);
  assert.match(sharedAuth, /http:\/\/localhost/);
  assert.match(sharedAuth, /http:\/\/127\.0\.0\.1/);
  assert.match(sharedAuth, /process\.env\.NODE_ENV === "production" && !origin && !referer/);
  assert.match(sharedAuth, /NEXT_PUBLIC_APP_URL/);
  assert.match(sharedAuth, /APP_URL/);
  assert.match(sharedAuth, /ALLOWED_ORIGINS/);
});
