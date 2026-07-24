import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const workspaceTabs = await jiti.import("../app/workspace/workspace-tabs.ts") as typeof import("../app/workspace/workspace-tabs.ts");
const {
  WORKSPACE_HOME_TAB_ID,
  createInitialWorkspaceTabsState,
  createWorkspaceTab,
  safeWorkspaceResetMenu,
  workspaceTabsReducer,
} = workspaceTabs;

test("workspace tabs keep home pinned and reuse an opened module list", () => {
  const initial = createInitialWorkspaceTabsState();
  const orders = createWorkspaceTab({ id: "orders:list", menuKey: "orders" });
  const opened = workspaceTabsReducer(initial, { type: "open", tab: orders, reuseBase: true });
  const duplicate = createWorkspaceTab({ id: "orders:duplicate", menuKey: "orders" });
  const reused = workspaceTabsReducer(opened, { type: "open", tab: duplicate, reuseBase: true });

  assert.equal(initial.tabs[0]?.id, WORKSPACE_HOME_TAB_ID);
  assert.equal(initial.tabs[0]?.pinned, true);
  assert.deepEqual(reused.tabs.map((tab) => tab.id), [WORKSPACE_HOME_TAB_ID, "orders:list"]);
  assert.equal(reused.activeTabId, "orders:list");
  assert.equal(workspaceTabsReducer(reused, { type: "close", tabId: WORKSPACE_HOME_TAB_ID }), reused);
});

test("turning a list into a detail keeps a separate list tab and closes back to it", () => {
  const orders = createWorkspaceTab({ id: "orders:detail", menuKey: "orders" });
  const listFallback = { ...createWorkspaceTab({ id: "orders:list", menuKey: "orders" }), autoFallbackFor: orders.id };
  const opened = workspaceTabsReducer(createInitialWorkspaceTabsState(), {
    type: "open",
    tab: orders,
    reuseBase: false,
  });
  const detailed = workspaceTabsReducer(opened, {
    type: "update",
    tabId: orders.id,
    patch: { title: "订单 · SO-1001", view: "detail", contextKey: "detail:1001" },
    fallbackListTab: listFallback,
  });

  assert.deepEqual(detailed.tabs.map((tab) => tab.id), [WORKSPACE_HOME_TAB_ID, "orders:detail", "orders:list"]);
  assert.equal(detailed.activeTabId, "orders:detail");
  assert.equal(detailed.tabs.find((tab) => tab.id === "orders:list")?.view, "list");

  const closed = workspaceTabsReducer(detailed, { type: "close", tabId: "orders:detail" });
  assert.equal(closed.activeTabId, "orders:list");
});

test("returning inside a detail removes only its unused automatic fallback list", () => {
  const home = createInitialWorkspaceTabsState().tabs[0]!;
  const detail = {
    ...createWorkspaceTab({ id: "orders:detail", menuKey: "orders" }),
    title: "订单 · SO-1001",
    view: "detail" as const,
    contextKey: "detail:1001",
  };
  const automaticList = {
    ...createWorkspaceTab({ id: "orders:auto-list", menuKey: "orders" }),
    autoFallbackFor: detail.id,
  };
  const manuallyOpenedList = createWorkspaceTab({ id: "orders:manual-list", menuKey: "orders" });
  const next = workspaceTabsReducer(
    { tabs: [home, detail, automaticList, manuallyOpenedList], activeTabId: detail.id },
    {
      type: "update",
      tabId: detail.id,
      patch: { title: "应收订单", view: "list", contextKey: "list:orders" },
    },
  );

  assert.deepEqual(next.tabs.map((tab) => tab.id), [WORKSPACE_HOME_TAB_ID, detail.id, manuallyOpenedList.id]);
  assert.equal(next.activeTabId, detail.id);
});

test("returning one of multiple details to a list removes every redundant automatic list", () => {
  const first = createWorkspaceTab({ id: "orders:first", menuKey: "orders" });
  const firstFallback = { ...createWorkspaceTab({ id: "orders:first-fallback", menuKey: "orders" }), autoFallbackFor: first.id };
  const secondFallback = { ...createWorkspaceTab({ id: "orders:second-fallback", menuKey: "orders" }), autoFallbackFor: firstFallback.id };
  let state = workspaceTabsReducer(createInitialWorkspaceTabsState(), { type: "open", tab: first, reuseBase: false });
  state = workspaceTabsReducer(state, {
    type: "update",
    tabId: first.id,
    patch: { title: "订单 A", view: "detail", contextKey: "detail:a" },
    fallbackListTab: firstFallback,
  });
  state = workspaceTabsReducer(state, {
    type: "update",
    tabId: firstFallback.id,
    patch: { title: "订单 B", view: "detail", contextKey: "detail:b" },
    fallbackListTab: secondFallback,
  });
  const returned = workspaceTabsReducer(state, {
    type: "update",
    tabId: first.id,
    patch: { title: "应收订单", view: "list", contextKey: "list:orders" },
  });

  assert.deepEqual(returned.tabs.map((tab) => tab.id), [WORKSPACE_HOME_TAB_ID, first.id, firstFallback.id]);
  assert.equal(returned.tabs.filter((tab) => tab.menuKey === "orders" && tab.view === "list").length, 1);
});

test("async detail return preserves the active automatic list and removes the background detail", () => {
  const detail = {
    ...createWorkspaceTab({ id: "orders:detail", menuKey: "orders" }),
    title: "订单 A",
    view: "detail" as const,
    contextKey: "detail:a",
  };
  const fallback = {
    ...createWorkspaceTab({ id: "orders:fallback", menuKey: "orders" }),
    autoFallbackFor: detail.id,
  };
  const home = createInitialWorkspaceTabsState().tabs[0]!;
  const returned = workspaceTabsReducer(
    { tabs: [home, detail, fallback], activeTabId: fallback.id },
    {
      type: "update",
      tabId: detail.id,
      patch: { title: "应收订单", view: "list", contextKey: "list:orders" },
    },
  );

  assert.deepEqual(returned.tabs.map((tab) => tab.id), [WORKSPACE_HOME_TAB_ID, fallback.id]);
  assert.equal(returned.activeTabId, fallback.id);
  assert.equal(returned.tabs.some((tab) => tab.id === returned.activeTabId), true);
});

test("default module navigation does not reuse a focused list and reset respects permissions", () => {
  const focused = createWorkspaceTab({
    id: "orders:focused",
    menuKey: "orders",
    focus: { keyword: "SO-1001" },
  });
  const opened = workspaceTabsReducer(createInitialWorkspaceTabsState(), { type: "open", tab: focused, reuseBase: false });
  const defaultList = createWorkspaceTab({ id: "orders:default", menuKey: "orders" });
  const next = workspaceTabsReducer(opened, { type: "open", tab: defaultList, reuseBase: true });

  assert.deepEqual(next.tabs.map((tab) => tab.id), [WORKSPACE_HOME_TAB_ID, focused.id, defaultList.id]);
  assert.equal(safeWorkspaceResetMenu("costs", new Set(["welcome", "orders"])), "welcome");
  assert.equal(safeWorkspaceResetMenu("orders", new Set(["welcome", "orders"])), "orders");
});

test("workspace tab context changes clear stale dirty state", () => {
  const orders = { ...createWorkspaceTab({ id: "orders:edit", menuKey: "orders" }), dirty: true, busy: true, view: "edit" as const };
  const state = { tabs: [createInitialWorkspaceTabsState().tabs[0]!, orders], activeTabId: orders.id };
  const next = workspaceTabsReducer(state, {
    type: "update",
    tabId: orders.id,
    patch: { title: "订单 · SO-1002", view: "detail", contextKey: "detail:1002" },
  });

  assert.equal(next.tabs.find((tab) => tab.id === orders.id)?.dirty, false);
  assert.equal(next.tabs.find((tab) => tab.id === orders.id)?.busy, true);
});

test("permission pruning removes forbidden module tabs without removing home or account", () => {
  const home = createInitialWorkspaceTabsState().tabs[0]!;
  const orders = createWorkspaceTab({ id: "orders:list", menuKey: "orders" });
  const costs = createWorkspaceTab({ id: "costs:list", menuKey: "costs" });
  const account = createWorkspaceTab({ id: "account", menuKey: "account" });
  const next = workspaceTabsReducer(
    { tabs: [home, orders, costs, account], activeTabId: costs.id },
    { type: "prune", allowedMenuKeys: ["orders"] },
  );

  assert.deepEqual(next.tabs.map((tab) => tab.menuKey), ["welcome", "orders", "account"]);
  assert.equal(next.activeTabId, WORKSPACE_HOME_TAB_ID);
});

test("dirty and busy state stay isolated to their owning tab while users switch modules", () => {
  const home = createInitialWorkspaceTabsState().tabs[0]!;
  const orders = createWorkspaceTab({ id: "orders:edit", menuKey: "orders" });
  const payments = createWorkspaceTab({ id: "payments:list", menuKey: "payments" });
  let state = { tabs: [home, orders, payments], activeTabId: orders.id };
  state = workspaceTabsReducer(state, {
    type: "update",
    tabId: orders.id,
    patch: { title: "编辑订单 · SO-1001", view: "edit", contextKey: "edit:1001" },
  });
  state = workspaceTabsReducer(state, { type: "update", tabId: orders.id, patch: { dirty: true } });
  state = workspaceTabsReducer(state, { type: "update", tabId: orders.id, patch: { busy: true } });
  state = workspaceTabsReducer(state, { type: "activate", tabId: payments.id });

  assert.equal(state.activeTabId, payments.id);
  assert.equal(state.tabs.find((tab) => tab.id === orders.id)?.dirty, true);
  assert.equal(state.tabs.find((tab) => tab.id === orders.id)?.busy, true);
  assert.equal(state.tabs.find((tab) => tab.id === payments.id)?.dirty, false);
  assert.equal(state.tabs.find((tab) => tab.id === payments.id)?.busy, false);
});

test("workspace shell mounts every opened panel and scopes overlays to their owning tab", () => {
  const shell = readFileSync("app/WorkspaceShell.tsx", "utf8");
  const tabsBar = readFileSync("app/workspace/WorkspaceTabsBar.tsx", "utf8");
  const dismissibleLayer = readFileSync("app/components/dismissible-layer.tsx", "utf8");
  const workspaceTabContext = readFileSync("app/workspace/workspace-tab-context.tsx", "utf8");
  const useWorkspaceTabs = readFileSync("app/workspace/use-workspace-tabs.ts", "utf8");

  assert.match(shell, /workspaceTabs\.tabs\.map\(\(tab\) => \(/);
  assert.match(shell, /hidden=\{!active\}/);
  assert.match(shell, /<WorkspaceTabProvider value=\{contextValue\}>/);
  assert.match(tabsBar, /role="tablist"/);
  assert.match(tabsBar, /role="tab"/);
  assert.match(tabsBar, /aria-selected=\{active\}/);
  assert.match(dismissibleLayer, /workspaceTab \? workspaceTab\.portalTarget : defaultPortalTarget/);
  assert.match(dismissibleLayer, /activeLayerStack\.at\(-1\) === layerIdRef\.current/);
  assert.match(dismissibleLayer, /if \(!isActive\) return;[\s\S]*lockBodyScroll\(\)/);
  assert.match(dismissibleLayer, /if \(!isActive\) return;[\s\S]*document\.addEventListener\("keydown"/);
  assert.match(dismissibleLayer, /workspaceTab \? styles\.workspaceTabDialogLayer/);
  assert.match(dismissibleLayer, /workspaceModal \? styles\.workspaceTabDialogModalSurface/);
  assert.match(dismissibleLayer, /workspaceDrawer && workspaceTab\?\.dirty/);
  assert.match(dismissibleLayer, /当前标签有未保存的修改，确定关闭吗/);
  assert.match(dismissibleLayer, /if \(workspaceTab\?\.busy\)/);
  assert.match(useWorkspaceTabs, /if \(tab\.busy\)/);
  assert.match(workspaceTabContext, /!workspaceTab\?\.dirty && !workspaceTab\?\.busy/);
});

test("editable settings, account, and supplier dialogs report exact dirty and busy state", () => {
  const account = readFileSync("app/AccountSettings.tsx", "utf8");
  const shell = readFileSync("app/WorkspaceShell.tsx", "utf8");
  const settings = readFileSync("app/modules/SettingsModule.tsx", "utf8");
  const ocrSettings = readFileSync("app/modules/settings/ocr-integration-settings-card.tsx", "utf8");
  const supplierDialog = readFileSync("app/modules/supplier-documents/create-request-dialog.tsx", "utf8");

  assert.match(account, /useWorkspaceTabDirty\(profileDirty \|\| securityDirty \|\| preferencesDirty\)/);
  assert.match(account, /useWorkspaceTabBusy\(busy\)/);
  assert.match(settings, /useWorkspaceTabDirty\(settingsFormDirty\)/);
  assert.match(settings, /useWorkspaceTabBusy\(settingsBusy\)/);
  assert.match(settings, /useOcrValidationRulesDraft\(settings\.activeTab === "ocrIntegration"\)/);
  assert.match(settings, /ocrValidationRulesDraft=\{ocrValidationRulesDraft\}/);
  assert.match(settings, /settings\.exchangeRefreshing/);
  assert.match(settings, /settings\.forceDeletingRejectedUserId/);
  assert.match(ocrSettings, /savedValidationRules/);
  assert.match(ocrSettings, /useWorkspaceTabDirty\(validationRulesDirty\)/);
  assert.match(ocrSettings, /\}, \[enabled, rulesLoaded\]\);/);
  assert.doesNotMatch(ocrSettings, /\[enabled, rulesLoaded, rulesLoading\]/);
  assert.match(supplierDialog, /<DismissibleLayer/);
  assert.match(supplierDialog, /useWorkspaceTabBusy\(saving\)/);
  assert.match(account, /onBeforePasswordChange\(profileDirty \|\| securitySettingsDirty \|\| preferencesDirty\)/);
  assert.match(shell, /otherTabs\.some\(\(tab\) => tab\.dirty\)/);
});

test("common mutable workflows register exact dirty, busy, and discard guards", () => {
  const orders = readFileSync("app/modules/OrdersModule.tsx", "utf8");
  const payments = readFileSync("app/modules/PaymentsModule.tsx", "utf8");
  const costs = readFileSync("app/modules/CostsModule.tsx", "utf8");
  const costDocuments = readFileSync("app/modules/costs/documents-drawer.tsx", "utf8");
  const domesticLogistics = readFileSync("app/modules/DomesticLogisticsModule.tsx", "utf8");
  const logisticsExpense = readFileSync("app/modules/logistics-fees/expense-form.tsx", "utf8");
  const taxRefund = readFileSync("app/modules/TaxRefundModule.tsx", "utf8");
  const taxRefundDetail = readFileSync("app/modules/tax-refund/detail-components.tsx", "utf8");
  const reports = readFileSync("app/modules/ReportsModule.tsx", "utf8");
  const workspaceTabStyles = readFileSync("app/styles/workspace-shell/workspace-tabs.module.css", "utf8");

  assert.match(orders, /guardedOpenEditOrder/);
  assert.match(payments, /replacingDraft/);
  assert.match(costs, /confirmDiscardCostEdit/);
  assert.match(costDocuments, /runGuardedTransition/);
  assert.match(costDocuments, /disabled=\{drawerBusy\}/);
  assert.match(domesticLogistics, /confirmDiscardLogisticsEdit/);
  assert.match(logisticsExpense, /useWorkspaceTabDirty\(controller\.dirty\)/);
  assert.match(taxRefund, /useWorkspaceTabBusy\(Boolean\(/);
  assert.match(taxRefundDetail, /confirmDiscardTaxRefundDraft/);
  assert.match(reports, /useWorkspaceTabBusy\(downloading\)/);
  assert.match(workspaceTabStyles, /max-width: 100% !important/);
  assert.match(workspaceTabStyles, /margin: 0 !important/);
});
