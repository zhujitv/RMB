import type { ActorLike, TodoUser, WorkbenchTodo } from "./workbench-todos-types";

export type ReminderOwner = {
  id: string;
  email?: string | null;
  role?: string | null;
};

export type ReminderCandidate<T extends Pick<WorkbenchTodo, "id" | "type"> = WorkbenchTodo> = {
  todo: T;
  overdueDays: number;
  ownerUserId?: string | null;
};

const FINANCE_WORKBENCH_DISPLAY_TODO_TYPES = new Set([
  "TAX_EXPORT_INVOICE_MISSING",
  "TAX_REFUND_READY_NOT_ARCHIVED",
  "TAX_REFUND_ARCHIVED",
]);

const FINANCE_WORKBENCH_REMINDER_TODO_TYPES = new Set([
  "TAX_EXPORT_INVOICE_MISSING",
  "TAX_REFUND_READY_NOT_ARCHIVED",
]);

const FINANCE_ONLY_WORKBENCH_TODO_TYPES = new Set([
  "TAX_EXPORT_INVOICE_MISSING",
]);

const LOGISTICS_WORKBENCH_TODO_TYPES = new Set([
  "LOGISTICS_INFO_MISSING",
  "BILL_OF_LADING_MISSING",
  "CONTAINER_NO_MISSING",
  "TAX_CUSTOMS_DECLARATION_MISSING",
  "LOGISTICS_FEE_ENTRY",
  "LOGISTICS_FEE_REVIEW",
  "LOGISTICS_INVOICE_UPLOAD",
  "LOGISTICS_PAYMENT_REGISTER",
  "CONTAINER_TRACKING_EXCEPTION",
  "ETA_ARRIVAL_ALERT",
  "LOGISTICS_FEE_REVIEW_COMPLETED",
  "LOGISTICS_INVOICE_UPLOAD_COMPLETED",
  "LOGISTICS_PAYMENT_REGISTER_COMPLETED",
  "CONTAINER_TRACKING_SYNCED",
]);

function roleText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isFinanceWorkbenchActor(actor: ActorLike) {
  return roleText(actor?.role) === "财务";
}

export function isFinanceWorkbenchDisplayTodoType(type: unknown) {
  return FINANCE_WORKBENCH_DISPLAY_TODO_TYPES.has(roleText(type));
}

export function isFinanceWorkbenchReminderTodoType(type: unknown) {
  return FINANCE_WORKBENCH_REMINDER_TODO_TYPES.has(roleText(type));
}

export function isFinanceOnlyWorkbenchTodoType(type: unknown) {
  return FINANCE_ONLY_WORKBENCH_TODO_TYPES.has(roleText(type));
}

export function isLogisticsWorkbenchTodoType(type: unknown) {
  return LOGISTICS_WORKBENCH_TODO_TYPES.has(roleText(type));
}

export function scopeWorkbenchTodosForActor<T extends { type?: string | null; ownerUserIds?: string[] | null }>(
  actor: ActorLike,
  todos: T[],
  options: { includeFinanceOnlyTodos?: boolean } = {},
) {
  if (isFinanceWorkbenchActor(actor)) {
    const actorUserId = roleText(actor?.id);
    return todos.filter((todo) => (
      isFinanceWorkbenchDisplayTodoType(todo.type)
      && (!isFinanceOnlyWorkbenchTodoType(todo.type) || Boolean(actorUserId && todo.ownerUserIds?.includes(actorUserId)))
    ));
  }
  if (options.includeFinanceOnlyTodos) return todos;
  return todos.filter((todo) => !isFinanceOnlyWorkbenchTodoType(todo.type));
}

export function canReceiveWorkbenchTodoReminder(recipient: Pick<TodoUser, "role"> | null | undefined, todo: Pick<WorkbenchTodo, "type">) {
  if (isFinanceOnlyWorkbenchTodoType(todo.type)) return roleText(recipient?.role) === "财务";
  if (roleText(recipient?.role) !== "财务") return true;
  return isFinanceWorkbenchReminderTodoType(todo.type);
}

function uniqueReminderCandidates<T extends Pick<WorkbenchTodo, "id" | "type">>(candidates: Array<ReminderCandidate<T>>) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const ownerUserId = roleText(candidate.ownerUserId);
    if (!ownerUserId) return false;
    const key = `${candidate.todo.id}:${ownerUserId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function planWorkbenchTodoReminderTargets<T extends Pick<WorkbenchTodo, "id" | "type">>(
  overdueTodoOwners: Array<ReminderCandidate<T>>,
  owners: ReminderOwner[],
) {
  const ownerById = new Map<string, ReminderOwner>(owners.map((owner) => [owner.id, owner]));
  const adminOwners = owners.filter((owner) => roleText(owner.role) === "管理员");
  const directEligibleTodoOwners = overdueTodoOwners.filter(({ todo, ownerUserId }) => {
    const owner = ownerById.get(roleText(ownerUserId));
    return canReceiveWorkbenchTodoReminder(owner, todo);
  });
  const policySkippedTodoOwners = overdueTodoOwners.filter(({ todo, ownerUserId }) => {
    const owner = ownerById.get(roleText(ownerUserId));
    return !canReceiveWorkbenchTodoReminder(owner, todo);
  });
  const adminFallbackTodoOwners = uniqueReminderCandidates(policySkippedTodoOwners
    .filter(({ todo }) => !isFinanceOnlyWorkbenchTodoType(todo.type))
    .flatMap(({ todo, overdueDays }) => (
      adminOwners.map((owner) => ({ todo, overdueDays, ownerUserId: owner.id }))
    )));
  return {
    ownerById,
    policySkippedTodoOwners,
    adminFallbackTodoOwners,
    eligibleTodoOwners: uniqueReminderCandidates([...directEligibleTodoOwners, ...adminFallbackTodoOwners]),
  };
}
