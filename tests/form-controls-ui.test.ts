import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const components = readFileSync("app/components.tsx", "utf8");
const settingsModule = readFileSync("app/modules/SettingsModule.tsx", "utf8");
const taxRefundModule = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
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
    "CheckboxOptionRow",
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

test("factory supplier callback documents use aligned card selection UI", () => {
  const requestIndex = taxRefundModule.indexOf("<strong>需要回传的资料</strong>");
  const requestSnippet = taxRefundModule.slice(Math.max(0, requestIndex - 360), requestIndex + 1000);

  assert.match(requestSnippet, /styles\.factoryDocumentChoiceGrid/);
  assert.match(requestSnippet, /<CheckboxOptionRow/);
  assert.match(requestSnippet, /checked=\{form\.requiredDocumentTypes\.includes\(item\.value\)\}/);
  assert.match(requestSnippet, /onChange=\{\(\) => toggleDocumentType\(item\.value\)\}/);
  assert.match(components, /<label className=\{mergeClassNames\(styles\.checkboxOptionRow/);
  assert.match(components, /className=\{styles\.checkboxOptionInput\}/);
  assert.match(components, /className=\{styles\.checkboxBox\} aria-hidden="true">✓<\/span>/);
  assert.match(components, /className=\{styles\.checkboxContent\}/);
  assert.match(workspaceStyles, /\.checkboxOptionRow \{[\s\S]*display: flex;[\s\S]*align-items: flex-start;[\s\S]*gap: 10px;/);
  assert.match(workspaceStyles, /\.checkboxBox \{[\s\S]*width: 18px;[\s\S]*height: 18px;/);
  assert.match(workspaceStyles, /\.checkboxContent \{[\s\S]*flex: 1;[\s\S]*margin-left: 10px;/);
  assert.match(workspaceStyles, /\.checkboxPanel input:not\(\.uiChoiceInput\):not\(\.checkboxOptionInput\)/);
  assert.doesNotMatch(workspaceStyles, /\.factoryDocumentChoiceCard/);
  assert.doesNotMatch(requestSnippet, /type=["']checkbox["']/);
});

test("supplier logistics cost types use card multi-select options", () => {
  const supplierCostIndex = settingsModule.indexOf("<strong>允许录入的物流费用类型</strong>");
  const supplierCostSnippet = settingsModule.slice(Math.max(0, supplierCostIndex - 420), supplierCostIndex + 1500);
  const supplierPanelIndex = settingsModule.indexOf("function SupplierEditPanel");
  const supplierPanelSnippet = settingsModule.slice(supplierPanelIndex, supplierPanelIndex + 7200);

  assert.match(settingsModule, /SUPPLIER_LOGISTICS_COST_TYPE_UI_META/);
  assert.match(supplierPanelSnippet, /<strong>基础信息<\/strong>/);
  assert.match(supplierPanelSnippet, /<strong>工厂供应商权限<\/strong>/);
  assert.match(supplierPanelSnippet, /<strong>物流供应商权限<\/strong>/);
  assert.match(supplierPanelSnippet, /\{factoryDocumentCapable \? \(/);
  assert.match(supplierPanelSnippet, /\{logisticsCapable \? \(/);
  assert.doesNotMatch(supplierPanelSnippet, /allowDomesticLogisticsEntry: LOGISTICS_SUPPLIER_TYPES\.includes\(supplierType\) \? form\.allowDomesticLogisticsEntry : false/);
  assert.doesNotMatch(supplierPanelSnippet, /allowFactoryDocumentUpload: supplierType === "工厂供应商" \? form\.allowFactoryDocumentUpload : false/);
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
  const userPanelIndex = settingsModule.indexOf("function UserEditPanel");
  const userPanelSnippet = settingsModule.slice(userPanelIndex, userPanelIndex + 12000);

  assert.match(permissionGroupSnippet, /<PermissionSelectItem/);
  assert.match(permissionGroupSnippet, /className=\{styles\.permissionOptionCard\}/);
  assert.match(permissionGroupSnippet, /styles\.permissionOptionGrid/);
  assert.match(permissionGroupSnippet, /checked=\{values\.includes\(option\.value\)\}/);
  assert.match(permissionGroupSnippet, /onChange=\{\(\) => onToggle\(option\.value\)\}/);
  assert.doesNotMatch(permissionGroupSnippet, /<UiCheckbox/);
  assert.doesNotMatch(permissionGroupSnippet, /variant="compact"/);
  assert.match(settingsModule, /styles\.userEditPanel/);
  assert.match(settingsModule, /styles\.userEditBasicGrid/);
  assert.match(settingsModule, /styles\.userEditSection/);
  assert.match(userPanelSnippet, /基本账号信息/);
  assert.match(userPanelSnippet, /权限方案/);
  assert.match(userPanelSnippet, /高级自定义权限/);
  assert.match(userPanelSnippet, /PERMISSION_MODE_DESCRIPTIONS/);
  assert.match(userPanelSnippet, /DATA_SCOPE_DESCRIPTIONS/);
  assert.match(userPanelSnippet, /styles\.permissionModeCards/);
  assert.match(userPanelSnippet, /styles\.dataScopeCardGrid/);
  assert.match(userPanelSnippet, /className=\{styles\.permissionSchemeCard\}/);
  assert.match(userPanelSnippet, /checked=\{form\.permissionMode === option\.value\}/);
  assert.match(userPanelSnippet, /onChange=\{\(\) => setPermissionMode\(option\.value\)\}/);
  assert.match(userPanelSnippet, /checked=\{form\.dataScope === option\.value\}/);
  assert.match(userPanelSnippet, /onChange=\{\(\) => setField\("dataScope", option\.value\)\}/);
  assert.match(userPanelSnippet, /const \[advancedPermissionsOpen, setAdvancedPermissionsOpen\] = useState\(false\)/);
  assert.match(userPanelSnippet, /const \[activePermissionTab, setActivePermissionTab\] = useState<PermissionTabKey>\("menus"\)/);
  assert.match(userPanelSnippet, /styles\.permissionTabs/);
  assert.match(userPanelSnippet, /setActivePermissionTab\(tab\)/);
  assert.match(userPanelSnippet, /activePermissionGroup\.title/);
  assert.match(userPanelSnippet, /activePermissionGroup\.options/);
  assert.match(userPanelSnippet, /activePermissionGroup\.values/);
  assert.match(userPanelSnippet, /togglePermission\("menus", value\)/);
  assert.match(userPanelSnippet, /togglePermission\("reads", value\)/);
  assert.match(userPanelSnippet, /togglePermission\("writes", value\)/);
  assert.doesNotMatch(userPanelSnippet, /<select value=\{form\.permissionMode\}/);
  assert.doesNotMatch(userPanelSnippet, /<select value=\{form\.dataScope\}/);
  assert.match(userPanelSnippet, /styles\.userEditActions/);
  assert.match(workspaceStyles, /\.userEditPanel \{[\s\S]*width: 100%;[\s\S]*max-width: 960px;[\s\S]*margin: 0 auto 18px;[\s\S]*padding: 0;/);
  assert.match(workspaceStyles, /\.userEditTitle,[\s\S]*\.userEditSection \{[\s\S]*width: 100%;[\s\S]*padding: 20px;[\s\S]*box-sizing: border-box;/);
  assert.match(workspaceStyles, /\.userEditBasicGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*gap: 16px;/);
  assert.match(workspaceStyles, /\.permissionModeCards \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*gap: 16px;/);
  assert.match(workspaceStyles, /\.dataScopeCardGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*gap: 16px;/);
  assert.match(workspaceStyles, /\.userEditActions \{[\s\S]*width: 100%;[\s\S]*box-sizing: border-box;/);
  assert.match(workspaceStyles, /\.permissionSchemeCard,[\s\S]*\.permissionOptionCard \{[\s\S]*display: flex;[\s\S]*justify-content: space-between;[\s\S]*gap: 12px;/);
  assert.match(workspaceStyles, /\.permissionSchemeCard \.uiChoiceInput,[\s\S]*\.permissionOptionCard \.uiChoiceInput \{[\s\S]*clip: rect\(0, 0, 0, 0\);[\s\S]*pointer-events: none;/);
  assert.match(workspaceStyles, /\.permissionSchemeCard \.uiChoiceText strong,[\s\S]*\.permissionOptionCard \.uiChoiceText strong \{[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(workspaceStyles, /\.permissionTabs \{/);
  assert.match(workspaceStyles, /\.permissionOptionGrid \{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);[\s\S]*gap: 16px/);
  assert.match(workspaceStyles, /@media \(max-width: 920px\) \{[\s\S]*\.permissionOptionGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(workspaceStyles, /@media \(max-width: 520px\) \{[\s\S]*\.userEditPanel \{[\s\S]*max-width: 100%;[\s\S]*padding: 0 12px;/);
  assert.match(workspaceStyles, /@media \(max-width: 520px\) \{[\s\S]*\.userEditTitle,[\s\S]*\.userEditSection \{[\s\S]*padding: 12px;/);
  assert.match(workspaceStyles, /@media \(max-width: 520px\) \{[\s\S]*\.userEditBasicGrid,[\s\S]*\.permissionModeCards,[\s\S]*\.dataScopeCardGrid \{[\s\S]*grid-template-columns: 1fr;/);
  assert.match(workspaceStyles, /@media \(max-width: 520px\) \{[\s\S]*\.permissionOptionGrid \{[\s\S]*grid-template-columns: 1fr;/);
});

test("user list detail action opens the inline user editor directly", () => {
  const settingsTableIndex = settingsModule.indexOf("function SettingsTable");
  const settingsTableSnippet = settingsModule.slice(settingsTableIndex, settingsTableIndex + 3600);
  const detailDrawerCallSnippet = settingsTableSnippet.match(/<SettingsDetailDrawer[\s\S]*?\/>/)?.[0] || "";
  const settingsRowsIndex = settingsModule.indexOf("function SettingsRows");
  const settingsRowsSnippet = settingsModule.slice(settingsRowsIndex, settingsRowsIndex + 2300);
  const startEditUserSnippet = settingsModule.match(/function startEditUser\(user: UserRow\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const startCreateUserSnippet = settingsModule.match(/function startCreateUser\(\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const saveUserSnippet = settingsModule.match(/async function saveUserForm[\s\S]*?\n  async function saveCompanyProfileSettings/)?.[0] || "";
  const userCancelSnippet = settingsModule.match(/<UserEditPanel[\s\S]*?onCancel=\{\(\) => \{[\s\S]*?\}\}/)?.[0] || "";
  const userEditorRenderIndex = settingsModule.indexOf("{userForm && activeTab === \"users\" ? (");
  const settingsTableRenderIndex = settingsModule.indexOf("<SettingsTable");

  assert.match(settingsModule, /const \[selectedUserId, setSelectedUserId\] = useState\(""\)/);
  assert.match(settingsModule, /const userEditPanelRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(settingsModule, /userEditPanelRef\.current\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.ok(settingsTableRenderIndex >= 0 && userEditorRenderIndex > settingsTableRenderIndex, "user editor should render after the user list table");
  assert.match(startCreateUserSnippet, /setSelectedUserId\("new"\)/);
  assert.match(startCreateUserSnippet, /setUserForm\(emptyUserForm\(\)\)/);
  assert.match(startEditUserSnippet, /setActiveTab\("users"\)/);
  assert.match(startEditUserSnippet, /setDetailRow\(null\)/);
  assert.match(startEditUserSnippet, /setSelectedUserId\(user\.id\)/);
  assert.match(startEditUserSnippet, /setUserForm\(userFormFromRow\(user\)\)/);
  assert.match(settingsRowsSnippet, /if \(tab === "users"\) \{[\s\S]*onEditUser\(row as UserRow\);[\s\S]*return;/);
  assert.match(settingsRowsSnippet, /<tr className=\{styles\.clickableRow\} onClick=\{handlePrimaryAction\}>/);
  assert.match(settingsRowsSnippet, /\{tab === "users" \? "编辑" : "详情"\}/);
  assert.match(settingsTableSnippet, /\{detailRow && tab !== "users" && tab !== "suppliers" \? \(/);
  assert.doesNotMatch(detailDrawerCallSnippet, /onEditUser=\{onEditUser\}/);
  assert.doesNotMatch(detailDrawerCallSnippet, /onDeleteUser=\{onDeleteUser\}/);
  assert.doesNotMatch(settingsModule, /<button className=\{styles\.primaryButtonCompact\} type="button" onClick=\{\(\) => onEditUser\(row as UserRow\)\}>编辑用户<\/button>/);
  assert.match(userCancelSnippet, /setUserForm\(null\)/);
  assert.match(userCancelSnippet, /setSelectedUserId\(""\)/);
  assert.match(saveUserSnippet, /setUserForm\(null\)/);
  assert.match(saveUserSnippet, /setSelectedUserId\(""\)/);
  assert.match(saveUserSnippet, /await loadTab\("users", activePagination\.page \|\| 1, filters\.users\)/);
});

test("supplier detail action opens unified supplier edit panel in read-only mode", () => {
  const settingsTableIndex = settingsModule.indexOf("function SettingsTable");
  const settingsTableSnippet = settingsModule.slice(settingsTableIndex, settingsTableIndex + 3600);
  const settingsTableRenderIndex = settingsModule.indexOf("<SettingsTable");
  const settingsTableRenderSnippet = settingsModule.slice(settingsTableRenderIndex, settingsTableRenderIndex + 1800);
  const settingsRowsIndex = settingsModule.indexOf("function SettingsRows");
  const settingsRowsSnippet = settingsModule.slice(settingsRowsIndex, settingsRowsIndex + 2300);
  const supplierPanelRenderSnippet = settingsModule.match(/\{supplierForm && activeTab === "suppliers"[\s\S]*?\) : null\}/)?.[0] || "";
  const startViewSupplierSnippet = settingsModule.match(/function startViewSupplier\(supplier: SupplierRow\) \{[\s\S]*?\n  \}/)?.[0] || "";
  const saveSupplierSnippet = settingsModule.match(/async function saveSupplierForm[\s\S]*?\n  async function saveUserForm/)?.[0] || "";
  const supplierPanelSnippet = settingsModule.match(/function SupplierEditPanel[\s\S]*?\n}\n\nfunction BooleanSelect/)?.[0] || "";

  assert.match(startViewSupplierSnippet, /setDetailRow\(null\)/);
  assert.match(startViewSupplierSnippet, /setSupplierPanelMode\("view"\)/);
  assert.match(startViewSupplierSnippet, /setSupplierForm\(supplierFormFromRow\(supplier\)\)/);
  assert.match(settingsModule, /const \[supplierPanelMode, setSupplierPanelMode\] = useState<"view" \| "edit">\("view"\)/);
  assert.match(settingsTableRenderSnippet, /if \(activeTab === "suppliers"\) \{[\s\S]*startViewSupplier\(row as SupplierRow\);[\s\S]*return;/);
  assert.match(settingsTableSnippet, /\{detailRow && tab !== "users" && tab !== "suppliers" \? \(/);
  assert.match(settingsRowsSnippet, /onViewDetail\(\)/);
  assert.match(supplierPanelRenderSnippet, /readOnly=\{Boolean\(supplierForm\.id\) && supplierPanelMode === "view"\}/);
  assert.match(supplierPanelRenderSnippet, /onEdit=\{\(\) => setSupplierPanelMode\("edit"\)\}/);
  assert.match(supplierPanelRenderSnippet, /onClose=\{closeSupplierPanel\}/);
  assert.match(supplierPanelRenderSnippet, /onCancel=\{cancelSupplierEdit\}/);
  assert.match(supplierPanelSnippet, /readOnly \? "供应商资料" : "编辑供应商资料"/);
  assert.match(supplierPanelSnippet, /disabled=\{controlsDisabled\}/);
  assert.match(supplierPanelSnippet, /编辑供应商/);
  assert.match(supplierPanelSnippet, /保存供应商/);
  assert.match(saveSupplierSnippet, /setSuppliers\(\(current\) =>/);
  assert.match(saveSupplierSnippet, /setSupplierPanelMode\("view"\)/);
  assert.doesNotMatch(saveSupplierSnippet, /await loadTab\("suppliers"/);
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
  assert.match(workspaceStyles, /\.loginSubmitButton \{[\s\S]*width: 100%;/);
  assert.match(workspaceStyles, /\.loginSubmitButton \{[\s\S]*background: var\(--button-primary-bg\) !important;/);
  assert.match(workspaceStyles, /\.loginSubmitButton \{[\s\S]*color: var\(--button-primary-text\) !important;/);
  assert.match(workspaceStyles, /\.loginSubmitButton:hover:not\(:disabled\),[\s\S]*background: var\(--button-primary-hover\) !important;/);
  assert.match(workspaceStyles, /\.loginSubmitButton:hover:not\(:disabled\),[\s\S]*color: var\(--button-primary-text\) !important;/);
  assert.match(workspaceStyles, /\.loginSubmitButton:disabled \{[\s\S]*background: var\(--button-disabled-bg\) !important;/);
  assert.match(workspaceStyles, /\.loginSubmitButton:disabled \{[\s\S]*color: var\(--button-disabled-text\) !important;/);
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
