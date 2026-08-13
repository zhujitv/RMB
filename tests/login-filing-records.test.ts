import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginPanel = readFileSync("app/LoginPanel.tsx", "utf8");
const loginStyles = readFileSync("app/styles/workspace-shell/auth-loading-screen.module.css", "utf8");
const filingStyles = readFileSync("app/styles/workspace-shell/login-filing-records.module.css", "utf8");

test("login footer exposes the ICP and public security filing records", () => {
  assert.match(loginPanel, /浙ICP备2026063624号-1/);
  assert.match(loginPanel, /https:\/\/beian\.miit\.gov\.cn\//);
  assert.match(loginPanel, /浙公网安备33068102001425号/);
  assert.match(loginPanel, /https:\/\/www\.beian\.gov\.cn\/portal\/registerSystemInfo\?recordcode=33068102001425/);
  assert.doesNotMatch(loginPanel, /beian\.mps\.gov\.cn/);
  assert.match(loginPanel, /aria-label="网站备案信息"/);
  assert.match(loginPanel, /rel="noopener noreferrer"/);
  assert.match(loginPanel, /loginIcpMark/);
  assert.match(loginPanel, /src="\/gongan\.png"/);
  assert.match(loginPanel, /loginFilingIcon/);
  assert.match(loginStyles, /\.loginFooter nav/);
  assert.match(loginStyles, /\.loginFooter a:focus-visible/);
  assert.match(filingStyles, /\.loginFilingLink/);
  assert.match(filingStyles, /\.loginFilingIcon/);
  assert.match(filingStyles, /\.loginIcpMark/);
});
