import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const responsiveDataView = readFileSync("app/ResponsiveDataView.tsx", "utf8");
const businessListModules = [
  "app/modules/DashboardModule.tsx",
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
  "app/modules/LogisticsFeesModule.tsx",
];

test("responsive data view only mounts one breakpoint branch", () => {
  assert.match(responsiveDataView, /const DESKTOP_QUERY = "\(min-width: 768px\)";/);
  assert.match(responsiveDataView, /window\.matchMedia\(DESKTOP_QUERY\)/);
  assert.match(responsiveDataView, /if \(!isDesktop && mobile\)/);
  assert.match(responsiveDataView, /return <>\{desktop\}<\/>;/);
  assert.match(responsiveDataView, /桌面端只显示表格，移动端只显示卡片/);
  assert.match(responsiveDataView, /禁止同一数据源在同一断点同时渲染 Card 和 Table/);
});

test("profit analysis uses responsive data view instead of css-hidden duplicate lists", () => {
  const profitModule = readFileSync("app/modules/ProfitModule.tsx", "utf8");

  assert.match(profitModule, /import \{ ResponsiveDataView \} from "\.\.\/ResponsiveDataView"/);
  assert.match(profitModule, /<ResponsiveDataView/);
  assert.match(profitModule, /mobile=\{\(/);
  assert.match(profitModule, /desktop=\{\(/);
  assert.match(profitModule, /<ProfitMobileCard/);
  assert.match(profitModule, /<ProfitRows/);
  assert.doesNotMatch(profitModule, /styles\.mobileOnly/);
  assert.doesNotMatch(profitModule, /styles\.desktopOnly/);
});

test("business list modules do not directly mount card and table branches together", () => {
  for (const filePath of businessListModules) {
    const source = readFileSync(filePath, "utf8");
    const hasMobileCards = /mobileCardList|mobileDataCard|function\s+\w*MobileCard|CardList/.test(source);
    const hasTable = /<table\s+className=\{styles\.dataTable\}/.test(source);

    if (hasMobileCards && hasTable) {
      assert.match(source, /<ResponsiveDataView/, `${filePath} must route card/table views through ResponsiveDataView`);
    }

    assert.doesNotMatch(
      source,
      /styles\.mobileOnly[\s\S]*styles\.desktopOnly|styles\.desktopOnly[\s\S]*styles\.mobileOnly/,
      `${filePath} must not mount separate css-hidden card/table branches`,
    );
  }
});
