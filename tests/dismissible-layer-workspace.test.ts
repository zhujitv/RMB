import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

type LayerStack = {
  mount: (id: symbol) => void;
  setActive: (id: symbol, active: boolean) => void;
  unmount: (id: symbol) => void;
  at: (index: number) => symbol | undefined;
  isTopActive: (id: symbol) => boolean;
};

type DismissibleLayerTestExports = {
  createDismissibleLayerStack: () => LayerStack;
  focusWorkspaceDialogSurface: (surface: HTMLElement, activeElement: Element | null) => boolean;
  restoreWorkspaceDialogFocus: (target: HTMLElement | null) => boolean;
};

function loadDismissibleLayerTestExports() {
  const source = readFileSync("app/components/dismissible-layer.tsx", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const runtimeModule: { exports: Record<string, unknown> } = { exports: {} };
  const styles = new Proxy({}, { get: (_target, key) => String(key) });
  const localRequire = (specifier: string) => {
    if (specifier === "react") return React;
    if (specifier === "react/jsx-runtime") return jsxRuntime;
    if (specifier === "react-dom") return { createPortal: (node: unknown) => node };
    if (specifier.endsWith(".module.css")) return styles;
    if (specifier.endsWith("/workspace/workspace-tab-context")) {
      return { useWorkspaceTabContext: () => null };
    }
    throw new Error(`Unexpected dismissible-layer test import: ${specifier}`);
  };

  new Function("require", "module", "exports", output)(localRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports as DismissibleLayerTestExports;
}

const {
  createDismissibleLayerStack,
  focusWorkspaceDialogSurface,
  restoreWorkspaceDialogFocus,
} = loadDismissibleLayerTestExports();

test("nested dismissible layer order survives workspace tab deactivation and reactivation", () => {
  const stack = createDismissibleLayerStack();
  const parent = Symbol("parent drawer");
  const child = Symbol("child preview");
  const otherTab = Symbol("other tab dialog");

  stack.mount(parent);
  stack.setActive(parent, true);
  stack.mount(child);
  stack.setActive(child, true);
  assert.equal(stack.at(-1), child);

  stack.setActive(child, false);
  stack.setActive(parent, false);
  stack.mount(otherTab);
  stack.setActive(otherTab, true);
  assert.equal(stack.at(-1), otherTab);

  stack.setActive(otherTab, false);
  stack.setActive(child, true);
  stack.setActive(parent, true);
  assert.equal(stack.at(-1), child);
  assert.equal(stack.isTopActive(parent), false);
  assert.equal(stack.isTopActive(child), true);

  stack.unmount(child);
  assert.equal(stack.at(-1), parent);
});

test("workspace dialog focus enters the top surface and restores only to a visible connected trigger", () => {
  const focusCalls: string[] = [];
  const insideElement = {} as Element;
  const preferredTarget = {
    focus: () => focusCalls.push("preferred"),
  } as unknown as HTMLElement;
  const surface = {
    contains: (element: Element) => element === insideElement,
    querySelector: () => preferredTarget,
    focus: () => focusCalls.push("surface"),
  } as unknown as HTMLElement;

  assert.equal(focusWorkspaceDialogSurface(surface, insideElement), false);
  assert.equal(focusCalls.length, 0);
  assert.equal(focusWorkspaceDialogSurface(surface, {} as Element), true);
  assert.equal(focusCalls.join(","), "preferred");

  const visibleTrigger = {
    isConnected: true,
    closest: () => null,
    focus: () => focusCalls.push("restored"),
  } as unknown as HTMLElement;
  const hiddenTrigger = {
    isConnected: true,
    closest: () => ({}),
    focus: () => focusCalls.push("hidden"),
  } as unknown as HTMLElement;
  const removedTrigger = {
    isConnected: false,
    closest: () => null,
    focus: () => focusCalls.push("removed"),
  } as unknown as HTMLElement;

  assert.equal(restoreWorkspaceDialogFocus(visibleTrigger), true);
  assert.equal(restoreWorkspaceDialogFocus(hiddenTrigger), false);
  assert.equal(restoreWorkspaceDialogFocus(removedTrigger), false);
  assert.equal(focusCalls.join(","), "preferred,restored");
});

test("dismissible layer keeps mount order stable, scopes focus to workspace, and resets a refused close animation", () => {
  const source = readFileSync("app/components/dismissible-layer.tsx", "utf8");

  assert.match(source, /activeLayerStack\.mount\(layerId\)/);
  assert.match(source, /activeLayerStack\.setActive\(layerIdRef\.current, isActive\)/);
  assert.doesNotMatch(source, /activeLayerStack\.push\(/);
  assert.match(source, /if \(!inWorkspace \|\| !isActive \|\| !portalTarget\) return;/);
  assert.match(source, /tabIndex=\{workspaceTab \? -1 : undefined\}/);
  assert.match(source, /aria-modal=\{isActive && !workspaceTab \? "true" : undefined\}/);
  assert.match(source, /closeTimerRef\.current = null;\s+setClosing\(false\);\s+onClose\(\);/);
});

test("cost drawer confirms a dirty draft once and leaves its animated onClose unguarded", () => {
  const costsModule = readFileSync("app/modules/CostsModule.tsx", "utf8");
  const costFormDrawer = readFileSync("app/modules/costs/cost-form-drawer.tsx", "utf8");
  const closeCostFormDrawer = costsModule.match(/function closeCostFormDrawer\(\) \{([\s\S]*?)\n  \}/)?.[1] || "";

  assert.match(costsModule, /onCloseCostForm=\{closeCostFormDrawer\}/);
  assert.doesNotMatch(costsModule, /onCloseCostForm=\{\(\) => \{\s+if \(!confirmDiscardCostEdit\(\)\) return;/);
  assert.doesNotMatch(closeCostFormDrawer, /confirmDiscardCostEdit/);
  assert.match(closeCostFormDrawer, /setCostFormDrawer\(null\)/);
  assert.match(costFormDrawer, /const requestCancel = \(\) => \{\s+if \(confirmDiscardCostEdit\(\)\) onCancel\(\);/);
  assert.match(costFormDrawer, /<SideDetailDrawer[\s\S]*onClose=\{onCancel\}/);
  assert.match(costFormDrawer, /<QuickCreateCostPanel[\s\S]*onCancel=\{requestCancel\}/);
});
