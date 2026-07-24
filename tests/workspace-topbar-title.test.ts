import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readCostsModuleSource,
  readDashboardModuleSource,
  readDomesticLogisticsModuleSource,
  readLogisticsFeesModuleSource,
  readOrdersModuleSource,
  readPaymentsModuleSource,
  readProfitModuleSource,
  readReportsModuleSource,
  readSettingsModuleSource,
  readTaxRefundModuleSource,
  readWorkspaceShellSource,
} from "./source-helpers.ts";

const workspaceLayout = readFileSync("app/WorkspaceLayout.tsx", "utf8");
const businessModuleSources = [
  readOrdersModuleSource(),
  readPaymentsModuleSource(),
  readCostsModuleSource(),
  readProfitModuleSource(),
  readDomesticLogisticsModuleSource(),
  readTaxRefundModuleSource(),
  readReportsModuleSource(),
  readSettingsModuleSource(),
  readDashboardModuleSource(),
  readLogisticsFeesModuleSource(),
].join("\n");

test("workspace topbar title follows the active business tab", () => {
  assert.match(workspaceLayout, /const topbarTitle = activeTabTitle \|\| menuTitle/);
  assert.match(workspaceLayout, /<h1>\{topbarTitle\}<\/h1>/);
  assert.doesNotMatch(workspaceLayout, /<span className=\{styles\.kicker\}>业务工作台<\/span>/);
});

test("workspace topbar handles home and account pages explicitly", () => {
  assert.match(workspaceLayout, /const menuTitle = activeMenu === "welcome"[\s\S]*\? "工作台首页"/);
  assert.match(workspaceLayout, /activeMenu === "account"[\s\S]*\? "账户设置"/);
});

test("business module headers only show the real module name once", () => {
  assert.doesNotMatch(businessModuleSources, /<span className=\{styles\.kicker\}>业务模块<\/span>/);
  assert.doesNotMatch(businessModuleSources, /Business Module|模块管理|业务工作台/);
  for (const title of ["应收订单", "收款管理", "成本管理", "利润分析", "物流信息", "退税资料", "报表中心"]) {
    assert.match(businessModuleSources, new RegExp(`<h2>${title}</h2>`));
  }
  assert.match(businessModuleSources, /系统设置中心/);
  assert.match(readWorkspaceShellSource(), /title="物流费用"/);
});
