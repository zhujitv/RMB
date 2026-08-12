import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { availableMenus, MENU_ITEMS } from "../app/menu.ts";
import {
  MENU_KEYS,
  optionList,
  READ_PERMISSION_KEYS,
  rolePermissionSnapshot,
  SETTINGS_PERMISSION_LABELS,
  WRITE_PERMISSION_KEYS,
} from "../lib/platform/shared-permission-data.ts";
import type { User } from "../app/types.ts";

const workspaceModuleContent = readFileSync("app/WorkspaceModuleContent.tsx", "utf8");
const sharedPermissions = readFileSync("lib/platform/shared-permissions.ts", "utf8");

function user(role: string): User {
  return {
    id: `${role}-user`,
    name: role,
    email: `${role}@example.com`,
    role,
  };
}

test("quotation menu is available only to the default administrator and salesperson roles", () => {
  const quotationMenu = MENU_ITEMS.find((item) => item.key === "quotations");
  assert.equal(quotationMenu?.label, "报价管理");

  assert.equal(availableMenus(user("管理员")).some((item) => item.key === "quotations"), true);
  assert.equal(availableMenus(user("业务员")).some((item) => item.key === "quotations"), true);

  for (const role of ["财务", "物流供应商", "产品供应商", "物流资料录入员"]) {
    assert.equal(availableMenus(user(role)).some((item) => item.key === "quotations"), false, `${role} must not see quotations`);
  }
});

test("quotation permissions follow administrator ALL and salesperson OWN customer-order scope", () => {
  const administrator = rolePermissionSnapshot("管理员");
  assert.equal(administrator.dataScope, "ALL");
  assert.equal(administrator.menus.includes("quotations"), true);
  assert.equal(administrator.reads.quotations, true);
  assert.equal(administrator.writes.quotations, true);

  const salesperson = rolePermissionSnapshot("业务员");
  assert.equal(salesperson.dataScope, "OWN");
  assert.equal(salesperson.menus.includes("quotations"), true);
  assert.equal(salesperson.reads.quotations, true);
  assert.equal(salesperson.writes.quotations, true);

  for (const role of ["财务", "物流供应商", "产品供应商", "物流资料录入员"]) {
    const snapshot = rolePermissionSnapshot(role);
    assert.equal(snapshot.menus.includes("quotations"), false, `${role} must not have the quotation menu`);
    assert.equal(snapshot.reads.quotations, false, `${role} must not read quotations`);
    assert.equal(snapshot.writes.quotations, false, `${role} must not write quotations`);
  }
});

test("quotation permissions are exposed to custom permission settings", () => {
  assert.equal(MENU_KEYS.includes("quotations"), true);
  assert.equal(READ_PERMISSION_KEYS.includes("quotations"), true);
  assert.equal(WRITE_PERMISSION_KEYS.includes("quotations"), true);
  assert.equal(SETTINGS_PERMISSION_LABELS.menu.quotations, "报价管理");
  assert.equal(SETTINGS_PERMISSION_LABELS.read.quotations, "报价查看");
  assert.equal(SETTINGS_PERMISSION_LABELS.write.quotations, "报价维护");

  assert.deepEqual(optionList(MENU_KEYS, SETTINGS_PERMISSION_LABELS.menu).find((option) => option.value === "quotations"), { value: "quotations", label: "报价管理" });
  assert.deepEqual(optionList(READ_PERMISSION_KEYS, SETTINGS_PERMISSION_LABELS.read).find((option) => option.value === "quotations"), { value: "quotations", label: "报价查看" });
  assert.deepEqual(optionList(WRITE_PERMISSION_KEYS, SETTINGS_PERMISSION_LABELS.write).find((option) => option.value === "quotations"), { value: "quotations", label: "报价维护" });
  assert.match(sharedPermissions, /\{ value: "OWN", label: "本人客户、报价、销售执行单和订单" \}/);
});

test("workspace lazy-loads and renders the quotation module with user permission context", () => {
  assert.match(workspaceModuleContent, /const QuotesModule = dynamic\(\(\) => import\("\.\/modules\/QuotesModule"\)/);
  assert.match(workspaceModuleContent, /if \(activeMenu === "quotations"\)[\s\S]*<QuotesModule/);
  assert.match(workspaceModuleContent, /<QuotesModule[\s\S]*currentUser=\{payload\.user\}[\s\S]*permissions=\{payload\.permissions\}[\s\S]*initialKeyword=\{focus\.keyword\}[\s\S]*initialOpenToken=\{focus\.token\}/);
});
