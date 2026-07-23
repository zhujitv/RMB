import assert from "node:assert/strict";
import test from "node:test";
import { workbenchTodosCacheKey } from "../lib/platform/workbench-todos-cache.ts";

test("workbench todo cache key changes with the actor permission version", () => {
  const baseActor = {
    id: "finance-1",
    role: "财务",
    supplierId: null,
    updatedAt: new Date("2026-07-23T00:00:00.000Z"),
    customPermissions: { menus: ["taxRefund"], dataScope: "ALL" },
  };

  const original = workbenchTodosCacheKey(baseActor);
  assert.notEqual(
    original,
    workbenchTodosCacheKey({
      ...baseActor,
      updatedAt: new Date("2026-07-23T00:01:00.000Z"),
    }),
  );
  assert.notEqual(
    original,
    workbenchTodosCacheKey({
      ...baseActor,
      customPermissions: { menus: [], dataScope: "NONE" },
    }),
  );
});
