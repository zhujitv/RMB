import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const components = readFileSync("app/components.tsx", "utf8");
const settingsModule = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const reportsModule = readFileSync("app/modules/ReportsModule.tsx", "utf8");
const workspaceStyles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("shared UI form controls are available for ERP pages", () => {
  for (const componentName of [
    "UiCheckbox",
    "UiRadio",
    "UiSelect",
    "UiSwitch",
    "UiDatePicker",
    "UiFileUpload",
    "UiButton",
    "UiTabs",
    "UiInput",
    "UiOptionCard",
  ]) {
    assert.match(components, new RegExp(`export function ${componentName}\\b`));
  }
});

test("commission formula uses card selections and switch control", () => {
  const negativeBaseSwitchIndex = settingsModule.indexOf('label="提成基数负数归零"');
  const negativeBaseSwitchSnippet = settingsModule.slice(Math.max(0, negativeBaseSwitchIndex - 120), negativeBaseSwitchIndex + 180);

  assert.match(settingsModule, /commissionDeductionGrid/);
  assert.match(settingsModule, /UiOptionCard/);
  assert.match(settingsModule, /从FOB中扣减物流费用/);
  assert.match(settingsModule, /扣减所有成本/);
  assert.match(negativeBaseSwitchSnippet, /<UiSwitch/);
  assert.doesNotMatch(negativeBaseSwitchSnippet, /BooleanSelect/);
  assert.match(settingsModule, /function BooleanSelect[\s\S]*<UiSwitch/);
  assert.doesNotMatch(settingsModule, /BOOLEAN_OPTIONS/);
  assert.doesNotMatch(settingsModule, /type=["']checkbox["']/);
  assert.doesNotMatch(reportsModule, /type=["']checkbox["']/);
  assert.doesNotMatch(workspaceStyles, /\[type=["']checkbox["']\]/);
});

test("native form controls are normalized by the workspace style layer", () => {
  assert.match(workspaceStyles, /\.uiSwitch/);
  assert.match(workspaceStyles, /\.uiChoiceCard/);
  assert.match(workspaceStyles, /\.uiCompactChoice/);
  assert.match(workspaceStyles, /\.uiTableCheckboxLabel/);
  assert.match(workspaceStyles, /\.uiFileUpload/);
  assert.match(workspaceStyles, /appearance: none/);
  assert.match(workspaceStyles, /input\[type="file"\]::file-selector-button/);
  assert.match(workspaceStyles, /input\[type="radio"\]:not\(\.uiChoiceInput\)/);
  assert.match(workspaceStyles, /background-image: url\("data:image\/svg\+xml/);
});
