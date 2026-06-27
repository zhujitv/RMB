import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const components = readFileSync("app/components.tsx", "utf8");
const settingsModule = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const reportsModule = readFileSync("app/modules/ReportsModule.tsx", "utf8");
const globalStyles = readFileSync("app/globals.css", "utf8");
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
    "PermissionSelectItem",
  ]) {
    assert.match(components, new RegExp(`export function ${componentName}\\b`));
  }
});

test("commission formula uses card selections and switch control", () => {
  const negativeBaseSwitchIndex = settingsModule.indexOf('label="提成基数负数归零"');
  const negativeBaseSwitchSnippet = settingsModule.slice(Math.max(0, negativeBaseSwitchIndex - 120), negativeBaseSwitchIndex + 180);

  assert.match(settingsModule, /commissionDeductionGrid/);
  assert.match(settingsModule, /PermissionSelectItem/);
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

test("auto-send document selection reuses commission formula card selection", () => {
  const autoSendIndex = settingsModule.indexOf("<strong>自动发送资料</strong>");
  const autoSendSnippet = settingsModule.slice(Math.max(0, autoSendIndex - 420), autoSendIndex + 900);

  assert.match(settingsModule, /const docConfig: ShippingDocumentConfig/);
  assert.match(settingsModule, /key: "invoice"/);
  assert.match(settingsModule, /key: "packingList"/);
  assert.match(settingsModule, /key: "customsDeclaration"/);
  assert.match(autoSendSnippet, /styles\.commissionDeductionGrid/);
  assert.match(autoSendSnippet, /<PermissionSelectItem/);
  assert.match(autoSendSnippet, /checked=\{docConfig\[option\.key\]\}/);
  assert.match(autoSendSnippet, /onChange=\{\(\) => toggleShippingDocumentType\(option\.key\)\}/);
  assert.doesNotMatch(autoSendSnippet, /variant="compact"/);
  assert.doesNotMatch(autoSendSnippet, /styles\.checkboxPanel/);
});

test("supplier logistics cost types use card multi-select options", () => {
  const supplierCostIndex = settingsModule.indexOf("<strong>允许录入的物流费用类型</strong>");
  const supplierCostSnippet = settingsModule.slice(Math.max(0, supplierCostIndex - 420), supplierCostIndex + 1500);

  assert.match(settingsModule, /SUPPLIER_LOGISTICS_COST_TYPE_UI_META/);
  for (const label of ["拖车费", "报关费", "港杂费", "海运费", "保险费", "ENS", "打单费", "查验费", "超重费", "提箱费", "进港费", "其他物流费用"]) {
    assert.match(settingsModule, new RegExp(label));
  }
  assert.match(supplierCostSnippet, /styles\.supplierLogisticsCostGrid/);
  assert.match(supplierCostSnippet, /LOGISTICS_COST_TYPE_OPTIONS\.map/);
  assert.match(supplierCostSnippet, /<PermissionSelectItem/);
  assert.match(supplierCostSnippet, /description=\{meta\?\.description/);
  assert.match(supplierCostSnippet, /checked=\{form\.allowedLogisticsCostTypes\.includes\(costType\)\}/);
  assert.match(supplierCostSnippet, /onChange=\{\(\) => toggleCostType\(costType\)\}/);
  assert.doesNotMatch(supplierCostSnippet, /variant="compact"/);
  assert.doesNotMatch(supplierCostSnippet, /styles\.checkboxPanel/);
  assert.match(workspaceStyles, /\.supplierLogisticsCostGrid \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(workspaceStyles, /@media \(max-width: 920px\) \{[\s\S]*\.supplierLogisticsCostGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(workspaceStyles, /@media \(max-width: 520px\) \{[\s\S]*\.supplierLogisticsCostGrid \{[\s\S]*grid-template-columns: 1fr;/);
});

test("user permissions reuse unified card multi-select options", () => {
  const permissionGroupIndex = settingsModule.indexOf("function PermissionChoiceGroup");
  const permissionGroupSnippet = settingsModule.slice(permissionGroupIndex, permissionGroupIndex + 1400);
  const customPermissionIndex = settingsModule.indexOf('title="菜单权限"');
  const customPermissionSnippet = settingsModule.slice(Math.max(0, customPermissionIndex - 420), customPermissionIndex + 1400);

  assert.match(permissionGroupSnippet, /<PermissionSelectItem/);
  assert.match(permissionGroupSnippet, /className=\{styles\.permissionOptionCard\}/);
  assert.match(permissionGroupSnippet, /styles\.permissionOptionGrid/);
  assert.match(permissionGroupSnippet, /checked=\{values\.includes\(option\.value\)\}/);
  assert.match(permissionGroupSnippet, /onChange=\{\(\) => onToggle\(option\.value\)\}/);
  assert.doesNotMatch(permissionGroupSnippet, /<UiCheckbox/);
  assert.doesNotMatch(permissionGroupSnippet, /variant="compact"/);
  assert.match(settingsModule, /styles\.userEditPanel/);
  assert.match(settingsModule, /styles\.userEditBasicGrid/);
  assert.match(settingsModule, /styles\.userPermissionPanel/);
  assert.match(settingsModule, /styles\.userPermissionModeGrid/);
  assert.match(customPermissionSnippet, /title="菜单权限"/);
  assert.match(customPermissionSnippet, /title="查看权限"/);
  assert.match(customPermissionSnippet, /title="操作权限"/);
  assert.match(customPermissionSnippet, /values=\{form\.menus\}/);
  assert.match(customPermissionSnippet, /values=\{form\.reads\}/);
  assert.match(customPermissionSnippet, /values=\{form\.writes\}/);
  assert.match(customPermissionSnippet, /togglePermission\("menus", value\)/);
  assert.match(customPermissionSnippet, /togglePermission\("reads", value\)/);
  assert.match(customPermissionSnippet, /togglePermission\("writes", value\)/);
  assert.match(workspaceStyles, /\.userEditPanel \{[\s\S]*max-width: 1040px;/);
  assert.match(workspaceStyles, /\.userPermissionModeGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(workspaceStyles, /\.userPermissionModeGrid label \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\);[\s\S]*white-space: nowrap;/);
  assert.match(workspaceStyles, /\.permissionOptionGrid \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);[\s\S]*gap: 16px/);
  assert.match(workspaceStyles, /\.permissionOptionCard \{[\s\S]*min-height: 48px;[\s\S]*grid-template-columns: minmax\(0, 1fr\) 22px;/);
  assert.match(workspaceStyles, /\.permissionOptionCard \.uiChoiceInput \{[\s\S]*clip: rect\(0, 0, 0, 0\);[\s\S]*pointer-events: none;/);
  assert.match(workspaceStyles, /\.permissionOptionCard \.uiChoiceCheck \{[\s\S]*position: static;[\s\S]*grid-column: 2;/);
  assert.match(workspaceStyles, /\.permissionOptionCard \.uiChoiceText strong \{[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(workspaceStyles, /@media \(max-width: 920px\) \{[\s\S]*\.permissionOptionGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(workspaceStyles, /@media \(max-width: 520px\) \{[\s\S]*\.userEditBasicGrid,[\s\S]*\.userPermissionModeGrid \{[\s\S]*grid-template-columns: 1fr;/);
  assert.match(workspaceStyles, /@media \(max-width: 520px\) \{[\s\S]*\.permissionOptionGrid \{[\s\S]*grid-template-columns: 1fr;/);
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

test("customer edit panel uses a portal drawer layer instead of inline table rendering", () => {
  const customerDrawerSnippet = settingsModule.match(/\{customerForm && activeTab === "customers"[\s\S]*?\) : null\}/)?.[0] || "";
  assert.match(components, /import \{ createPortal \} from "react-dom"/);
  assert.match(components, /const \[portalTarget, setPortalTarget\] = useState<HTMLElement \| null>\(null\)/);
  assert.match(components, /setPortalTarget\(document\.body\)/);
  assert.match(components, /document\.body\.style\.overflow = "hidden"/);
  assert.match(components, /document\.body\.style\.overflow = previousBodyOverflow \|\| "auto"/);
  assert.match(components, /return portalTarget \? createPortal\(layer, portalTarget\) : null/);
  assert.match(customerDrawerSnippet, /<SideDetailDrawer/);
  assert.match(customerDrawerSnippet, /ariaLabel=\{customerForm\.id \? "编辑客户资料" : "新建客户资料"\}/);
  assert.match(customerDrawerSnippet, /surfaceClassName=\{styles\.settingsCustomerDrawer\}/);
  assert.match(customerDrawerSnippet, /<CustomerEditPanel/);
  assert.match(workspaceStyles, /\.drawerOverlay \{[\s\S]*z-index: 9998;[\s\S]*background: rgba\(0, 0, 0, 0\.45\);/);
  assert.match(workspaceStyles, /\.sideDrawer \{[\s\S]*position: fixed;[\s\S]*z-index: 9999;/);
  assert.match(workspaceStyles, /\.sideDrawer\.settingsCustomerDrawer \{[\s\S]*width: min\(640px, 92vw\);/);
});

test("system buttons use unified design tokens and avoid black backgrounds", () => {
  assert.match(globalStyles, /--button-primary-bg: #1677ff/);
  assert.match(globalStyles, /--button-primary-hover: #4096ff/);
  assert.match(globalStyles, /--button-primary-text: #ffffff/);
  assert.match(globalStyles, /--button-secondary-bg: #e6f4ff/);
  assert.match(globalStyles, /--button-danger-bg: #ff4d4f/);
  assert.match(workspaceStyles, /\.primaryButton \{[\s\S]*background: var\(--button-primary-bg\)/);
  assert.match(workspaceStyles, /\.primaryButtonCompact \{[\s\S]*background: var\(--button-primary-bg\)/);
  assert.match(workspaceStyles, /\.rowDetailButton \{[\s\S]*background: var\(--button-primary-bg\)/);
  assert.match(workspaceStyles, /\.fileActionButton \{[\s\S]*background: var\(--button-primary-bg\)/);
  assert.match(workspaceStyles, /\.dataTable button:not\(:disabled\) \{[\s\S]*background: var\(--button-primary-bg\)/);
  assert.match(workspaceStyles, /\.billApproveButton \{[\s\S]*background: var\(--button-primary-bg\)/);
  assert.match(workspaceStyles, /\.dangerButton \{[\s\S]*background: var\(--button-danger-bg\)/);
  assert.match(workspaceStyles, /\.secondaryButton \{[\s\S]*background: var\(--button-secondary-bg\)/);
  assert.doesNotMatch(
    workspaceStyles,
    /(?:button|Button|Btn)[^{]*\{[^}]*background(?:-color)?:\s*(?:#111827|#000|#333|black)/i,
  );
});
