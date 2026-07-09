import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authController = readFileSync("app/workspace/use-workspace-auth-controller.ts", "utf8");
const loginPanel = readFileSync("app/LoginPanel.tsx", "utf8");
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");

test("registration submits all required fields and shows feedback inside the modal", () => {
  assert.match(authController, /const name = String\(form\.get\("name"\) \|\| ""\)\.trim\(\)/);
  assert.match(authController, /const email = normalizeEmail\(String\(form\.get\("email"\) \|\| ""\)\)/);
  assert.match(authController, /body: JSON\.stringify\(\{ name, email, password, confirmPassword \}\)/);
  assert.match(authController, /setRegisterMessage\("请填写姓名。"\)/);
  assert.match(authController, /setRegisterMessage\(error instanceof Error \? error\.message : "提交注册申请失败"\)/);
  assert.match(authController, /setRegisterOpen\(false\)/);
  assert.match(authController, /setRegisterOpen: toggleRegisterOpen/);

  assert.match(loginPanel, /registerMessage\?: string/);
  assert.match(loginPanel, /registerPasswordError \|\| registerConfirmError \|\| registerMessage/);
  assert.match(loginPanel, /setRegisterPassword\(""\)/);
  assert.match(loginPanel, /setRegisterConfirmPassword\(""\)/);
  assert.match(workspaceShell, /registerMessage=\{registerMessage\}/);
});
