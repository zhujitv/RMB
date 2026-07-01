import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceLayout = readFileSync("app/WorkspaceLayout.tsx", "utf8");
const businessModuleSources = [
  "app/modules/OrdersModule.tsx",
  "app/modules/PaymentsModule.tsx",
  "app/modules/CostsModule.tsx",
  "app/modules/ProfitModule.tsx",
  "app/modules/DomesticLogisticsModule.tsx",
  "app/modules/TaxRefundModule.tsx",
  "app/modules/tax-refund/list-panel.tsx",
  "app/modules/ReportsModule.tsx",
  "app/modules/SettingsModule.tsx",
  "app/modules/settings/module-view.tsx",
  "app/modules/DashboardModule.tsx",
  "app/modules/LogisticsFeesModule.tsx",
].map((file) => readFileSync(file, "utf8")).join("\n");

test("workspace topbar title is derived from the active menu", () => {
  assert.match(workspaceLayout, /const topbarTitle = activeMenu === "welcome"[\s\S]*active\?\.label \|\| "功能模块"/);
  assert.match(workspaceLayout, /<h1>\{topbarTitle\}<\/h1>/);
  assert.doesNotMatch(workspaceLayout, /<span className=\{styles\.kicker\}>业务工作台<\/span>/);
});

test("workspace topbar handles home and account pages explicitly", () => {
  assert.match(workspaceLayout, /activeMenu === "welcome"[\s\S]*\? "工作台首页"/);
  assert.match(workspaceLayout, /activeMenu === "account"[\s\S]*\? "账户设置"/);
});

test("business module headers only show the real module name once", () => {
  assert.doesNotMatch(businessModuleSources, /<span className=\{styles\.kicker\}>业务模块<\/span>/);
  assert.doesNotMatch(businessModuleSources, /Business Module|模块管理|业务工作台/);
  for (const title of ["应收订单", "收款管理", "成本管理", "利润分析", "物流信息", "退税资料", "报表中心"]) {
    assert.match(businessModuleSources, new RegExp(`<h2>${title}</h2>`));
  }
  assert.match(businessModuleSources, /系统设置中心/);
  assert.match(readFileSync("app/WorkspaceShell.tsx", "utf8"), /title="物流费用"/);
});
