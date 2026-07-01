import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workbenchRules = await import("../lib/platform/workbench-todo-rules.ts");
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");
const workspaceLayout = readFileSync("app/WorkspaceLayout.tsx", "utf8");
const welcomePanel = readFileSync("app/WelcomePanel.tsx", "utf8");
const route = readFileSync("app/api/workbench/todos/route.ts", "utf8");
const workbenchSource = readFileSync("lib/platform/workbench-todos.ts", "utf8");
const styles = readFileSync("app/styles/workspace-shell/workbench.module.css", "utf8");

test("workbench todo priority follows due date rules", () => {
  const now = new Date("2026-07-01T04:00:00.000Z");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-06-30T15:59:59.000Z", now), "urgent");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-07-01T15:59:59.000Z", now), "urgent");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-07-03T15:59:59.000Z", now), "important");
  assert.equal(workbenchRules.todoPriorityFromDueAt("2026-07-08T15:59:59.000Z", now), "normal");
  assert.equal(workbenchRules.todoPriorityFromDueAt(null, now), "normal");
});

test("workbench todo summary counts pending, today due, overdue and completed", () => {
  const now = new Date("2026-07-01T04:00:00.000Z");
  const base = {
    module: "物流费用",
    orderId: "order-1",
    orderNo: "NW-1",
    customerShortName: "ABC",
    ownerName: "张三",
    action: { label: "处理", href: "/logistics-fees?keyword=NW-1" },
  };
  const summary = workbenchRules.summarizeWorkbenchTodos([
    { ...base, id: "overdue", type: "A", title: "逾期", priority: "urgent", status: "pending", dueAt: "2026-06-30T15:59:59.000Z" },
    { ...base, id: "today", type: "B", title: "今日", priority: "urgent", status: "pending", dueAt: "2026-07-01T15:59:59.000Z" },
    { ...base, id: "normal", type: "C", title: "普通", priority: "normal", status: "pending", dueAt: null },
  ], 5, now);
  assert.deepEqual(summary, {
    pending: 3,
    todayDue: 1,
    overdue: 1,
    completed: 5,
    total: 3,
    urgent: 2,
  });
});

test("workbench todos api uses backend aggregation and current actor", () => {
  assert.match(route, /requireApiActor\(request\)/);
  assert.match(route, /listWorkbenchTodos\(actor\)/);
  assert.match(workbenchSource, /orderAccessWhere\(actor\)/);
  assert.match(workbenchSource, /supplierId: actorSupplierId\(actor\) \|\| "__no_supplier_bound__"/);
  assert.match(workbenchSource, /status: \{ notIn: PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE \}/);
  assert.match(workbenchSource, /refreshTaxRefundCompleteness\(order\.id\)/);
});

test("workbench home and topbar consume unified todo DTO without opening new windows", () => {
  assert.match(workspaceShell, /apiJson<Partial<WorkbenchTodosState>>\("\/api\/workbench\/todos"/);
  assert.match(workspaceShell, /function openWorkbenchTodo\(todo: WorkbenchTodo\)/);
  assert.match(workspaceShell, /setActiveMenu\("logisticsFees"\)/);
  assert.match(workspaceShell, /setActiveMenu\("supplierDocuments"\)/);
  assert.match(workspaceLayout, /待办 \{pendingCount\}/);
  assert.match(workspaceLayout, /topTodos = workbenchTodos\.todos\.slice\(0, 10\)/);
  assert.match(workspaceLayout, /onClick=\{\(\) => handleOpenTodo\(todo\)\}/);
  assert.doesNotMatch(workspaceLayout, /target="_blank"/);
  assert.match(welcomePanel, /待处理/);
  assert.match(welcomePanel, /今日到期/);
  assert.match(welcomePanel, /已逾期/);
  assert.match(welcomePanel, /已完成/);
  assert.match(styles, /overflow: hidden;/);
  assert.match(styles, /table-layout: fixed;/);
});
