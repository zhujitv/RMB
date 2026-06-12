import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync("lib/platform-db.js", "utf8");
const frontend = readFileSync("app.js", "utf8");
const publicFrontend = readFileSync("public/app.js", "utf8");
const ledgerRoute = readFileSync("app/api/ledger/route.js", "utf8");
const overviewRoute = readFileSync("app/api/overview/route.js", "utf8");

function roleMenuLine(source, role) {
  return source.split("\n").find((line) => line.trim().startsWith(`${role}: [`)) || "";
}

test("salesperson, finance, cost entry and viewer fixed menus do not expose global dashboard", () => {
  for (const source of [backend, frontend, publicFrontend]) {
    assert(!roleMenuLine(source, "业务员").includes('"dashboard"'));
    assert(!roleMenuLine(source, "财务").includes('"dashboard"'));
    assert(!roleMenuLine(source, "成本录入员").includes('"profit"'));
    assert(!roleMenuLine(source, "查看者").includes('"dashboard"'));
  }
});

test("viewer fixed role has no default business data scope or reads", () => {
  assert.match(backend, /if \(role === "管理员" \|\| role === "财务"\) return "ALL";/);
  assert(!backend.includes('role === "管理员" || role === "财务" || role === "查看者"'));
  assert.match(frontend, /查看者: "NONE"/);
  assert.match(publicFrontend, /查看者: "NONE"/);
  assert.match(frontend, /查看者: \[\]/);
  assert.match(publicFrontend, /查看者: \[\]/);
});

test("global dashboard APIs require admin global scope before returning data", () => {
  assert.match(backend, /export function requireAdminGlobal/);
  assert.match(backend, /export async function getOverview[\s\S]*requireAdminGlobal\(actor, "无权限访问经营总览"\)/);
  assert.match(ledgerRoute, /requireAdminGlobal\(actor, "无权限访问经营总览"\)/);
  assert.match(overviewRoute, /requireAdminGlobal\(actor, "无权限访问经营总览"\)/);
});

test("frontend clears stale data on auth changes and forbidden responses", () => {
  for (const source of [frontend, publicFrontend]) {
    assert.match(source, /sessionStorage\.clear\(\)/);
    assert.match(source, /function handleForbidden/);
    assert.match(source, /response\.status === 403[\s\S]*handleForbidden/);
    assert.match(source, /clearLocalCaches\(\);[\s\S]*state\.overview = null;/);
  }
});
