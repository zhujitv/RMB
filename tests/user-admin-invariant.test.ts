import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

process.env.DATABASE_URL ||= "postgresql://security-test:security-test@127.0.0.1:5432/security-test";

const jiti = createJiti(import.meta.url);
const invariant = await jiti.import<typeof import("../lib/platform/shared-users-admin-invariant.ts")>(
  "../lib/platform/shared-users-admin-invariant.ts",
);
const adminSource = readFileSync("lib/platform/shared-users-admin.ts", "utf8");

test("active administrator demotions are the only mutations requiring the invariant", () => {
  const activeAdmin = { role: "管理员", approvalStatus: "APPROVED", isActive: true };
  assert.equal(invariant.isActiveAdministratorDemotion(activeAdmin, "业务员", "APPROVED"), true);
  assert.equal(invariant.isActiveAdministratorDemotion(activeAdmin, "管理员", "DISABLED"), true);
  assert.equal(invariant.isActiveAdministratorDemotion(activeAdmin, "管理员", "APPROVED"), false);
  assert.equal(invariant.isActiveAdministratorDemotion({ ...activeAdmin, isActive: false }, "业务员", "DISABLED"), false);
});

test("last active administrator check rejects a transaction without another administrator", async () => {
  const transaction = {
    user: { findFirst: async () => null },
  };
  await assert.rejects(
    () => invariant.assertAnotherActiveAdministrator(transaction as never, "admin-only"),
    (error: unknown) => (error as { status?: number; code?: string }).status === 409
      && (error as { code?: string }).code === "LAST_ACTIVE_ADMIN_REQUIRED",
  );
});

test("status changes evaluate the current administrator state inside the transaction", async () => {
  const transaction = {
    user: {
      findUnique: async () => ({ role: "管理员", approvalStatus: "APPROVED", isActive: true }),
      findFirst: async () => null,
    },
  };
  await assert.rejects(
    () => invariant.assertAdministratorStatusChange(transaction as never, "admin-only", "DISABLED"),
    (error: unknown) => (error as { code?: string }).code === "LAST_ACTIVE_ADMIN_REQUIRED",
  );
});

test("administrator invariant transactions use serializable retries", async () => {
  let attempts = 0;
  const result = await invariant.runAdministratorInvariantTransaction(
    async () => "saved",
    async (operation) => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("serialization conflict"), { code: "P2034" });
      return operation({} as never);
    },
  );
  assert.equal(result, "saved");
  assert.equal(attempts, 3);
  assert.equal(invariant.ADMINISTRATOR_TRANSACTION_OPTIONS.isolationLevel, "Serializable");
});

test("both profile and status administrator demotions run the invariant inside the transaction", () => {
  assert.equal((adminSource.match(/runAdministratorInvariantTransaction\(/g) || []).length, 2);
  assert.equal((adminSource.match(/assertAnotherActiveAdministrator\(tx, id\)/g) || []).length, 1);
  assert.equal((adminSource.match(/assertAdministratorStatusChange\(tx, id, nextStatus\)/g) || []).length, 1);
  assert.doesNotMatch(adminSource, /await assertAnotherActiveAdministrator\(id\)/);
});
