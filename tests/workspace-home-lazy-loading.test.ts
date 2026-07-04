import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readWorkspaceShellSource } from "./source-helpers.ts";

const workspaceShell = readWorkspaceShellSource();
const apiClient = readFileSync("app/api.ts", "utf8");

test("workspace home keeps business modules lazy-loaded behind menu selection", () => {
  assert.match(workspaceShell, /const \[activeMenu, setActiveMenu\] = useState\("welcome"\)/);
  assert.match(workspaceShell, /import dynamic from "next\/dynamic"/);
  for (const moduleName of [
    "OrdersModule",
    "DashboardModule",
    "PaymentsModule",
    "CostsModule",
    "DomesticLogisticsModule",
    "LogisticsFeesModule",
    "ProfitModule",
    "TaxRefundModule",
    "ReportsModule",
    "SettingsModule",
  ]) {
    assert.doesNotMatch(workspaceShell, new RegExp(`import \\{ ${moduleName} \\} from "\\./modules/`));
    assert.match(workspaceShell, new RegExp(`const ${moduleName} = dynamic\\(\\(\\) => import\\("\\./modules/`));
  }
  assert.match(workspaceShell, /activeMenu === "welcome"[\s\S]*<WelcomePanel/);
  assert.match(workspaceShell, /if \(auth\.status === "guest"\) void loadPublicCompanyProfile\(\)/);
  assert.doesNotMatch(workspaceShell, /void loadPublicCompanyProfile\(\);\s*\}, \[\]\)/);
});

test("api client logs development timing for slow local request triage only", () => {
  assert.match(apiClient, /function startApiRequestTimer/);
  assert.match(apiClient, /process\.env\.NODE_ENV === "production"/);
  assert.match(apiClient, /console\.time\(label\)/);
  assert.match(apiClient, /console\.timeEnd\(label\)/);
});
