import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceLayout = readFileSync("app/WorkspaceLayout.tsx", "utf8");

test("workspace topbar title is derived from the active menu", () => {
  assert.match(workspaceLayout, /const topbarTitle = activeMenu === "welcome"[\s\S]*active\?\.label \|\| "功能模块"/);
  assert.match(workspaceLayout, /<h1>\{topbarTitle\}<\/h1>/);
  assert.doesNotMatch(workspaceLayout, /<span className=\{styles\.kicker\}>业务工作台<\/span>/);
});

test("workspace topbar handles home and account pages explicitly", () => {
  assert.match(workspaceLayout, /activeMenu === "welcome"[\s\S]*\? "工作台首页"/);
  assert.match(workspaceLayout, /activeMenu === "account"[\s\S]*\? "账户设置"/);
});
