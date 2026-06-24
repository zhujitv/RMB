import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rolePermissionSnapshot } from "../lib/platform/shared-permission-data.ts";

const backend = [
  readFileSync("lib/platform/shared-constants.ts", "utf8"),
  readFileSync("lib/platform/shared-permission-data.ts", "utf8"),
  readFileSync("lib/platform/shared-access.ts", "utf8"),
  readFileSync("lib/platform/profit-overview.ts", "utf8"),
].join("\n");
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");
const menuFile = readFileSync("app/menu.ts", "utf8");
const ledgerRoute = readFileSync("app/api/ledger/route.ts", "utf8");
const overviewRoute = readFileSync("app/api/overview/route.ts", "utf8");
const sharedAuth = readFileSync("lib/platform/shared-auth.ts", "utf8");
const reportService = readFileSync("lib/report-service.ts", "utf8");
const reportsModule = readFileSync("app/modules/ReportsModule.tsx", "utf8");

function roleMenuLine(source: string, role: string) {
  return source.split("\n").find((line: string) => line.includes(`${role}: [`)) || "";
}

test("fixed role menus do not expose forbidden global modules", () => {
  for (const source of [backend, menuFile]) {
    assert(!roleMenuLine(source, "业务员").includes('"dashboard"'));
    assert(!roleMenuLine(source, "业务员").includes('"profit"'));
    assert(!roleMenuLine(source, "财务").includes('"dashboard"'));
  }
  assert.match(backend, /物流供应商: \["domesticLogistics", "manual"\]/);
  assert.match(menuFile, /物流供应商: \["domesticLogistics", "manual"\]/);
  assert.match(backend, /logisticsReview: "物流费用审核"/);
  assert.match(menuFile, /logisticsReview", "taxRefund"/);
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
  assert.equal(admin.menus.includes("logisticsReview"), true);

  const salesperson = rolePermissionSnapshot("业务员");
  assert.equal(salesperson.dataScope, "OWN");
  assert.equal(salesperson.menus.includes("dashboard"), false);
  assert.equal(salesperson.menus.includes("profit"), false);
  assert.equal(salesperson.menus.includes("logisticsReview"), false);
  assert.equal(salesperson.reads.payments, true);
  assert.equal(salesperson.reads.taxRefund, true);
  assert.equal(salesperson.reads.commissions, false);
  assert.equal(salesperson.writes.payments, false);
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

  const logisticsSupplier = rolePermissionSnapshot("物流供应商");
  assert.deepEqual(logisticsSupplier.menus, ["domesticLogistics", "manual"]);
  assert.equal(logisticsSupplier.menus.includes("logisticsReview"), false);
  assert.equal(logisticsSupplier.dataScope, "OWN");
  assert.equal(logisticsSupplier.reads.payments, false);
  assert.equal(logisticsSupplier.reads.costs, false);
  assert.equal(logisticsSupplier.reads.commissions, false);
  assert.equal(logisticsSupplier.writes.logistics, true);
  assert.equal(logisticsSupplier.writes.domesticLogistics, true);
  assert.equal(logisticsSupplier.writes.documents, true);
  assert.equal(logisticsSupplier.writes.settings, false);

  const logisticsClerk = rolePermissionSnapshot("物流资料录入员");
  assert.deepEqual(logisticsClerk.menus, ["domesticLogistics", "manual"]);
  assert.equal(logisticsClerk.dataScope, "OWN");
  assert.equal(logisticsClerk.reads.domesticLogistics, true);
  assert.equal(logisticsClerk.reads.documents, true);
  assert.equal(logisticsClerk.reads.payments, false);
  assert.equal(logisticsClerk.writes.domesticLogistics, true);
  assert.equal(logisticsClerk.writes.documents, true);
  assert.equal(logisticsClerk.writes.logistics, false);
});

test("workspace auth distinguishes expired login from server-side profile failure", () => {
  assert.match(workspaceShell, /function clearClientAuthState\(\)/);
  assert.match(workspaceShell, /window\.localStorage\.removeItem\(key\)/);
  assert.match(workspaceShell, /window\.sessionStorage\.removeItem\(key\)/);
  assert.match(workspaceShell, /function authLoadErrorState\(error: unknown\): AuthState/);
  assert.match(workspaceShell, /message: error\.code === "PASSWORD_CHANGE_REQUIRED" \? error\.message : "登录已过期，请重新登录。"/);
  assert.match(workspaceShell, /message: "系统暂时无法读取账户信息。"/);
  assert.match(workspaceShell, /message: "工作台初始化失败。"/);
  assert.match(workspaceShell, /setAuth\(nextAuth \|\| \{ status: "error", message: "工作台初始化失败。", detail: "初始化流程未返回有效状态。"/);
});

test("workspace boot order enters loading before permission checks", () => {
  assert.match(workspaceShell, /const \[auth, setAuth\] = useState<AuthState>\(\{ status: "loading", message: "正在加载工作台\.\.\." \}\)/);
  assert.match(workspaceShell, /if \(auth\.status === "loading"\) \{\s*return <LoadingPanel message=\{auth\.message\} \/>\s*;\s*\}/);
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
