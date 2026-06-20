import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceStyles = readFileSync("app/WorkspaceShell.module.css", "utf8");

test("shared data table typography matches tax refund and logistics tables", () => {
  assert.match(workspaceStyles, /\.dataTable td \{[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
  assert.match(workspaceStyles, /\.dataTable td strong \{[\s\S]*color: #475569;[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
  assert.match(workspaceStyles, /\.dataTable button,[\s\S]*\.dataTable textarea \{[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
  assert.match(workspaceStyles, /\.dataTable th,[\s\S]*\.tableSortButton \{[\s\S]*font-size: 13px;[\s\S]*font-weight: var\(--font-weight-subtitle\);/);
  assert.match(workspaceStyles, /\.dataTable td,[\s\S]*\.moneyCell,[\s\S]*:global\(\.text-table\) \{[\s\S]*font-size: 13px;[\s\S]*font-weight: var\(--font-weight-body\);/);
  assert.match(workspaceStyles, /\.dataTable \.statusPill \{[\s\S]*font-size: 13px;[\s\S]*font-weight: var\(--font-weight-body\);/);
  assert.match(workspaceStyles, /\.paginationBar \{[\s\S]*font-size: 13px;[\s\S]*font-weight: 400;/);
});
