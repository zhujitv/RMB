import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginPanel = readFileSync("app/LoginPanel.tsx", "utf8");
const loginStyles = readFileSync("app/styles/workspace-shell/auth-loading-screen.module.css", "utf8");

test("login footer exposes the ICP filing record", () => {
  assert.match(loginPanel, /浙ICP备2026063624号-1/);
  assert.match(loginPanel, /https:\/\/beian\.miit\.gov\.cn\//);
  assert.doesNotMatch(loginPanel, /3a9ee9d124d0ba86f3b41b2fc18f11be/);
  assert.match(loginPanel, /aria-label="网站备案信息"/);
  assert.match(loginPanel, /rel="noopener noreferrer"/);
  assert.match(loginStyles, /\.loginFooter nav/);
  assert.match(loginStyles, /\.loginFooter a:focus-visible/);
});
