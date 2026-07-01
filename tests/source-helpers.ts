import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_MODULE_FILES = [
  "app/modules/SettingsModule.tsx",
  "app/modules/settings/use-settings-controller.ts",
  "app/modules/settings/module-view.tsx",
  "app/modules/settings/types.ts",
  "app/modules/settings/constants.ts",
  "app/modules/settings/helpers.ts",
  "app/modules/settings/common-controls.tsx",
  "app/modules/settings/customer-supplier-panels.tsx",
  "app/modules/settings/settings-cards.tsx",
  "app/modules/settings/settings-table.tsx",
  "app/modules/settings/user-edit-panel.tsx",
];

const DOMESTIC_LOGISTICS_MODULE_FILES = [
  "app/modules/DomesticLogisticsModule.tsx",
  "app/modules/domestic-logistics/model.ts",
  "app/modules/domestic-logistics/helpers.ts",
  "app/modules/domestic-logistics/shipsgo-format.ts",
  "app/modules/domestic-logistics/control-tower.tsx",
  "app/modules/domestic-logistics/customs-documents-panel.tsx",
  "app/modules/domestic-logistics/edit-panel.tsx",
  "app/modules/domestic-logistics/order-tracking-panel.tsx",
  "app/modules/domestic-logistics/rows.tsx",
];

const TAX_REFUND_MODULE_FILES = [
  "app/modules/TaxRefundModule.tsx",
  "app/modules/tax-refund/use-tax-refund-controller.ts",
  "app/modules/tax-refund/list-panel.tsx",
  "app/modules/tax-refund/overlays.tsx",
  "app/modules/tax-refund/model.ts",
  "app/modules/tax-refund/helpers.ts",
  "app/modules/tax-refund/dialogs.tsx",
  "app/modules/tax-refund/detail-components.tsx",
  "app/modules/tax-refund/table-row.tsx",
  "app/modules/tax-refund/upload-components.tsx",
];

const COSTS_MODULE_FILES = [
  "app/modules/CostsModule.tsx",
  "app/modules/costs/model.ts",
  "app/modules/costs/cost-form-drawer.tsx",
  "app/modules/costs/cost-table.tsx",
  "app/modules/costs/detail-drawers.tsx",
  "app/modules/costs/invoice-actions.tsx",
  "app/modules/costs/documents-drawer.tsx",
  "app/modules/costs/helpers.ts",
];

const LOGISTICS_FEES_MODULE_FILES = [
  "app/modules/LogisticsFeesModule.tsx",
  "app/modules/logistics-fees/model.ts",
  "app/modules/logistics-fees/bill-table.tsx",
  "app/modules/logistics-fees/details-drawer.tsx",
  "app/modules/logistics-fees/expense-form.tsx",
  "app/modules/logistics-fees/invoice-groups-panel.tsx",
  "app/modules/logistics-fees/monthly-summary.tsx",
  "app/modules/logistics-fees/shared.tsx",
  "app/modules/logistics-fees/shared-csv.ts",
  "app/modules/logistics-fees/shared-currency.ts",
  "app/modules/logistics-fees/shared-drafts.ts",
  "app/modules/logistics-fees/shared-monthly-summary.tsx",
  "app/modules/logistics-fees/shared-order-helpers.ts",
  "app/modules/logistics-fees/shared-row-reconcile.ts",
  "app/modules/logistics-fees/shared-status.ts",
];

export function readSettingsModuleSource() {
  return SETTINGS_MODULE_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
}

export function readCostsModuleSource() {
  return COSTS_MODULE_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
}

export function readLogisticsFeesModuleSource() {
  return LOGISTICS_FEES_MODULE_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
}

export function readDomesticLogisticsModuleSource() {
  return DOMESTIC_LOGISTICS_MODULE_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
}

export function readTaxRefundModuleSource() {
  return TAX_REFUND_MODULE_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
}

export function readWorkspaceStylesSource() {
  const shardDir = "app/styles/workspace-shell";
  const shards = readdirSync(shardDir)
    .filter((file) => file.endsWith(".module.css"))
    .sort()
    .map((file) => readFileSync(join(shardDir, file), "utf8"));

  return [readFileSync("app/WorkspaceShell.module.css", "utf8"), ...shards].join("\n");
}
