import type { ActorLike } from "./workbench-todos-types";

type WorkbenchTodosCacheEntry = {
  expiresAt: number;
  value: unknown;
};

export const WORKBENCH_TODOS_CACHE_MS = Math.max(0, Number(process.env.WORKBENCH_TODOS_CACHE_MS || 15000));

export function workbenchTodosCache() {
  const store = globalThis as typeof globalThis & {
    __nextwoodWorkbenchTodosCache?: Map<string, WorkbenchTodosCacheEntry>;
  };
  store.__nextwoodWorkbenchTodosCache ||= new Map<string, WorkbenchTodosCacheEntry>();
  return store.__nextwoodWorkbenchTodosCache;
}

export function workbenchTodosCacheKey(actor: ActorLike) {
  return [
    actor?.id || "",
    actor?.role || "",
    actor?.supplierId || "",
  ].join(":");
}

export function invalidateWorkbenchTodosCache() {
  workbenchTodosCache().clear();
}
