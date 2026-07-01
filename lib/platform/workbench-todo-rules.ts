export type WorkbenchTodoPriority = "urgent" | "important" | "normal";

export type WorkbenchTodoForSummary = {
  priority: WorkbenchTodoPriority;
  status?: "pending" | "completed";
  dueAt?: string | null;
};

export type WorkbenchTodoSummary = {
  pending: number;
  todayDue: number;
  overdue: number;
  completed: number;
  total: number;
  urgent: number;
};

export function startOfChinaDay(now = new Date()) {
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaTime = new Date(now.getTime() + chinaOffsetMs);
  return new Date(Date.UTC(chinaTime.getUTCFullYear(), chinaTime.getUTCMonth(), chinaTime.getUTCDate()) - chinaOffsetMs);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function todoPriorityFromDueAt(dueAt: Date | string | null | undefined, now = new Date()): WorkbenchTodoPriority {
  const due = dueAt ? new Date(dueAt) : null;
  if (!due || Number.isNaN(due.getTime())) return "normal";
  const today = startOfChinaDay(now);
  if (due < addDays(today, 1)) return "urgent";
  if (due < addDays(today, 3)) return "important";
  return "normal";
}

export function isDueToday(dueAt: string | null | undefined, now = new Date()) {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  const today = startOfChinaDay(now);
  return due >= today && due < addDays(today, 1);
}

export function isOverdue(dueAt: string | null | undefined, now = new Date()) {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  return due < startOfChinaDay(now);
}

export function summarizeWorkbenchTodos<T extends WorkbenchTodoForSummary>(todos: T[], completed = 0, now = new Date()): WorkbenchTodoSummary {
  const pending = todos.filter((todo) => todo.status !== "completed");
  return {
    pending: pending.length,
    todayDue: pending.filter((todo) => isDueToday(todo.dueAt, now)).length,
    overdue: pending.filter((todo) => isOverdue(todo.dueAt, now)).length,
    completed,
    total: pending.length,
    urgent: pending.filter((todo) => todo.priority === "urgent").length,
  };
}
