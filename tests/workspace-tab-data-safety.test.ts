import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readTaxRefundModuleSource } from "./source-helpers.ts";

test("report queries ignore stale responses after tab reactivation or filter changes", () => {
  const source = readFileSync("app/modules/ReportsModule.tsx", "utf8");

  assert.match(source, /const queryRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+queryRequestRef\.current/);
  assert.match(source, /if \(requestId !== queryRequestRef\.current\) return;/);
  assert.match(source, /if \(requestId === queryRequestRef\.current\) setLoading\(false\)/);
  assert.match(source, /function clearResults\(\) \{\s*queryRequestRef\.current \+= 1;\s*setLoading\(false\)/);
});

test("tax refund targeting stays inside its owning workspace panel", () => {
  const source = readFileSync("app/modules/tax-refund/use-tax-refund-controller.ts", "utf8");

  assert.match(source, /workspaceTab\?\.portalTarget\?\.parentElement\?\.querySelector/);
  assert.doesNotMatch(source, /document\.getElementById\(targetId\)/);
});

test("customs recognition preserves a dirty manual draft from sibling document refreshes", () => {
  const source = readTaxRefundModuleSource();

  assert.match(source, /if \(!detailChanged && formDirty\) return;/);
  assert.match(source, /formDirty && !window\.confirm\("当前手工填写的报关单信息尚未保存/);
  assert.match(source, /disabled=\{readOnly \|\| saving \|\| rereading\}/);
});

test("control tower ignores stale loads and sync refreshes the latest submitted filters", () => {
  const source = readFileSync("app/modules/domestic-logistics/control-tower.tsx", "utf8");

  assert.match(source, /const loadRequestRef = useRef\(0\)/);
  assert.match(source, /const requestId = \+\+loadRequestRef\.current/);
  assert.match(source, /if \(requestId !== loadRequestRef\.current\) return;/);
  assert.match(source, /if \(requestId === loadRequestRef\.current\) setLoading\(false\)/);
  assert.match(source, /loadControlTower\(submittedFiltersRef\.current, true\)/);
});
