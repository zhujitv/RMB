import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_MODULE_FILES = [
  "app/modules/SettingsModule.tsx",
  "app/modules/settings/types.ts",
  "app/modules/settings/constants.ts",
  "app/modules/settings/helpers.ts",
  "app/modules/settings/common-controls.tsx",
  "app/modules/settings/customer-supplier-panels.tsx",
  "app/modules/settings/settings-cards.tsx",
  "app/modules/settings/settings-table.tsx",
  "app/modules/settings/user-edit-panel.tsx",
];

export function readSettingsModuleSource() {
  return SETTINGS_MODULE_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
}

export function readWorkspaceStylesSource() {
  const shardDir = "app/styles/workspace-shell";
  const shards = readdirSync(shardDir)
    .filter((file) => file.endsWith(".module.css"))
    .sort()
    .map((file) => readFileSync(join(shardDir, file), "utf8"));

  return [readFileSync("app/WorkspaceShell.module.css", "utf8"), ...shards].join("\n");
}
