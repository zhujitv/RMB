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
  "TAX_REFUND_READY_NOT_ARCHIVED",
  "TAX_REFUND_ARCHIVED",
]);

const FINANCE_WORKBENCH_REMINDER_TODO_TYPES = new Set([
  "TAX_REFUND_READY_NOT_ARCHIVED",
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

export function scopeWorkbenchTodosForActor<T extends { type?: string | null }>(actor: ActorLike, todos: T[]) {
  if (!isFinanceWorkbenchActor(actor)) return todos;
  return todos.filter((todo) => isFinanceWorkbenchDisplayTodoType(todo.type));
}

export function canReceiveWorkbenchTodoReminder(recipient: Pick<TodoUser, "role"> | null | undefined, todo: Pick<WorkbenchTodo, "type">) {
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
  const adminFallbackTodoOwners = uniqueReminderCandidates(policySkippedTodoOwners.flatMap(({ todo, overdueDays }) => (
    adminOwners.map((owner) => ({ todo, overdueDays, ownerUserId: owner.id }))
  )));
  return {
    ownerById,
    policySkippedTodoOwners,
    adminFallbackTodoOwners,
    eligibleTodoOwners: uniqueReminderCandidates([...directEligibleTodoOwners, ...adminFallbackTodoOwners]),
  };
}
