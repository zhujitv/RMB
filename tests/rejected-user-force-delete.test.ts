import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const readSource = (path: string) => readFileSync(join(root, path), "utf8");

test("rejected user force delete is guarded by backend status and admin checks", () => {
  const sharedUsersAdmin = readSource("lib/platform/shared-users-admin.ts");
  const usersRoute = readSource("app/api/users/[id]/route.ts");
  const sharedUsersList = readSource("lib/platform/shared-users-list.ts");
  const schema = readSource("prisma/schema.prisma");

  assert.match(schema, /deletedAt\s+DateTime\?\s+@map\("deleted_at"\)/);
  assert.match(sharedUsersAdmin, /export async function forceDeleteRejectedUser/);
  assert.match(sharedUsersAdmin, /actor\?\.role !== "管理员"/);
  assert.match(sharedUsersAdmin, /actor\?\.id === id/);
  assert.match(sharedUsersAdmin, /before\.approvalStatus !== "REJECTED"/);
  assert.match(sharedUsersAdmin, /prisma\.user\.delete\(\{ where: \{ id \} \}\)/);
  assert.match(sharedUsersAdmin, /Prisma\.PrismaClientKnownRequestError && error\.code === "P2003"/);
  assert.match(sharedUsersAdmin, /email: rejectedUserDeletedEmail\(before\.email\)/);
  assert.match(sharedUsersAdmin, /deletedAt: new Date\(\)/);
  assert.match(sharedUsersAdmin, /writeAudit\(request, actor, "强制删除拒绝用户", "users", id, before/);
  assert.match(usersRoute, /forceDeleteRejectedUser/);
  assert.match(usersRoute, /searchParams\.get\("forceRejected"\)/);
  assert.match(usersRoute, /message: "拒绝用户已删除"/);
  assert.match(sharedUsersList, /deletedAt: null/);
  assert.match(sharedUsersList, /email: \{ startsWith: "deleted_", mode: "insensitive" \}/);
});

test("settings users table exposes force delete only for rejected users", () => {
  const workspaceModuleContent = readSource("app/WorkspaceModuleContent.tsx");
  const settingsTypes = readSource("app/modules/settings/types.ts");
  const settingsController = readSource("app/modules/settings/use-settings-controller.ts");
  const settingsTable = readSource("app/modules/settings/settings-table.tsx");
  const settingsActions = readSource("app/modules/settings/use-settings-controller-actions.ts");
  const settingsState = readSource("app/modules/settings/use-settings-state.ts");
  const settingsPanels = readSource("app/modules/settings/module-edit-panels.tsx");

  assert.match(workspaceModuleContent, /<SettingsModule currentUser=\{payload\.user\}/);
  assert.match(settingsTypes, /currentUser\?: \{ role\?: string \} \| null/);
  assert.match(settingsController, /canForceDeleteRejectedUsers: currentUser\?\.role === "管理员"/);
  assert.match(settingsState, /forceDeletingRejectedUserId/);
  assert.match(settingsActions, /function forceDeleteRejectedUser|async function forceDeleteRejectedUser/);
  assert.match(settingsActions, /user\.approvalStatus !== "REJECTED"/);
  assert.match(settingsActions, /确认强制删除该拒绝用户？此操作不可恢复。/);
  assert.match(settingsActions, /\/api\/users\/\$\{encodeURIComponent\(user\.id\)\}\?forceRejected=1/);
  assert.match(settingsActions, /拒绝用户已删除/);
  assert.match(settingsPanels, /onForceDeleteRejectedUser/);
  assert.match(settingsTable, /canForceDeleteRejectedUsers && tab === "users" && \(row as UserRow\)\.approvalStatus === "REJECTED"/);
  assert.match(settingsTable, /styles\.dangerButton/);
  assert.match(settingsTable, /删除中\.\.\./);
  assert.match(settingsTable, /强制删除/);
  assert.doesNotMatch(settingsTable, /onDeleteUser/);
});
