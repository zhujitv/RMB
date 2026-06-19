import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

function roleMenuLine(source: string, role: string) {
  return source.split("\n").find((line: string) => line.includes(`${role}: [`)) || "";
}

test("fixed role menus do not expose forbidden global modules", () => {
  for (const source of [backend, menuFile]) {
    assert(!roleMenuLine(source, "业务员").includes('"dashboard"'));
    assert(!roleMenuLine(source, "财务").includes('"dashboard"'));
  }
  assert.match(backend, /物流供应商: \["domesticLogistics", "manual"\]/);
  assert.match(menuFile, /物流供应商: \["domesticLogistics", "manual"\]/);
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

test("workspace auth distinguishes expired login from server-side profile failure", () => {
  assert.match(workspaceShell, /function clearClientAuthState\(\)/);
  assert.match(workspaceShell, /window\.localStorage\.removeItem\(key\)/);
  assert.match(workspaceShell, /window\.sessionStorage\.removeItem\(key\)/);
  assert.match(workspaceShell, /setAuth\(\{ status: "guest", message: error\.code === "PASSWORD_CHANGE_REQUIRED" \? error\.message : "登录已过期，请重新登录。"/);
  assert.match(workspaceShell, /setAuth\(\{ status: "error", message: "系统暂时无法读取账户信息，请联系管理员。"/);
  assert.match(workspaceShell, /setAuth\(\{ status: "error", message: error instanceof Error \? error\.message : "用户信息加载失败" \}\)/);
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
