import assert from "node:assert/strict";
import test from "node:test";
import { readWorkspaceStylesSource } from "./source-helpers.ts";

const workspaceStyles = readWorkspaceStylesSource();

test("shared data table typography matches tax refund and logistics tables", () => {
  assert.match(workspaceStyles, /\.dataTable td \{[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
  assert.match(workspaceStyles, /\.dataTable td strong \{[\s\S]*color: #475569;[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
  assert.match(workspaceStyles, /\.dataTable button,[\s\S]*\.dataTable textarea \{[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
  assert.match(workspaceStyles, /\.dataTable th,[\s\S]*\.tableSortButton \{[\s\S]*font-size: 13px;[\s\S]*font-weight: var\(--font-weight-subtitle\);/);
  assert.match(workspaceStyles, /\.dataTable td,[\s\S]*\.moneyCell,[\s\S]*:global\(\.text-table\) \{[\s\S]*font-size: 13px;[\s\S]*font-weight: var\(--font-weight-body\);/);
  assert.match(workspaceStyles, /\.dataTable \.statusPill \{[\s\S]*font-size: 13px;[\s\S]*font-weight: var\(--font-weight-body\);/);
  assert.match(workspaceStyles, /\.statusPill \{[\s\S]*white-space: nowrap;[\s\S]*word-break: keep-all;[\s\S]*overflow-wrap: normal;/);
  assert.match(workspaceStyles, /\.logisticsFeeStatusBadge \{[\s\S]*white-space: nowrap;[\s\S]*word-break: keep-all;[\s\S]*overflow-wrap: normal;/);
  assert.match(workspaceStyles, /\.dataTable th\.statusColumn,[\s\S]*\.dataTable td\.statusColumn \{[\s\S]*width: 112px;[\s\S]*white-space: nowrap;/);
  assert.match(workspaceStyles, /\.paginationBar \{[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
});
