import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import type { WorkspaceTabFocusable } from "../app/workspace/use-workspace-tabs.ts";

const jiti = createJiti(import.meta.url);
const workspaceTabInteractions = await jiti.import("../app/workspace/use-workspace-tabs.ts") as typeof import("../app/workspace/use-workspace-tabs.ts");
const {
  canDuplicateWorkspaceMenu,
  focusWorkspaceTabAfterAction,
  shouldReuseWorkspaceBaseTab,
} = workspaceTabInteractions;

test("welcome and account stay singleton even when callers request a new tab", () => {
  assert.equal(canDuplicateWorkspaceMenu("welcome"), false);
  assert.equal(canDuplicateWorkspaceMenu("account"), false);
  assert.equal(canDuplicateWorkspaceMenu("orders"), true);

  assert.equal(shouldReuseWorkspaceBaseTab("account", {}, true), true);
  assert.equal(shouldReuseWorkspaceBaseTab("welcome", {}, true), true);
  assert.equal(shouldReuseWorkspaceBaseTab("orders", {}, true), false);
  assert.equal(shouldReuseWorkspaceBaseTab("orders", { keyword: "SO-1001" }), false);
  assert.equal(shouldReuseWorkspaceBaseTab("orders"), true);
});

function focusable(connected: boolean) {
  const state = {
    focused: 0,
  };
  const element: WorkspaceTabFocusable = {
    isConnected: connected,
    focus() {
      state.focused += 1;
    },
  };
  return { element, state };
}

test("a cancelled close keeps focus on the connected close source", () => {
  const source = focusable(true);
  const active = focusable(true);

  const target = focusWorkspaceTabAfterAction(source.element, active.element, true);

  assert.equal(target, source.element);
  assert.equal(source.state.focused, 1);
  assert.equal(active.state.focused, 0);
});

test("a completed close focuses the new active tab after its source disconnects", () => {
  const source = focusable(false);
  const active = focusable(true);

  const target = focusWorkspaceTabAfterAction(source.element, active.element, true);

  assert.equal(target, active.element);
  assert.equal(source.state.focused, 0);
  assert.equal(active.state.focused, 1);
});

test("opening a new tab focuses it instead of preserving the new-tab button", () => {
  const source = focusable(true);
  const active = focusable(true);

  const target = focusWorkspaceTabAfterAction(source.element, active.element, false);

  assert.equal(target, active.element);
  assert.equal(source.state.focused, 0);
  assert.equal(active.state.focused, 1);
});
