import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginPanel = readFileSync("app/LoginPanel.tsx", "utf8");
const loginStyles = readFileSync("app/styles/workspace-shell/auth-loading-screen.module.css", "utf8");
const filingStyles = readFileSync("app/styles/workspace-shell/login-filing-records.module.css", "utf8");
const icpIcon = readFileSync("public/icp-beian.png");

test("login footer exposes the ICP and public security filing records", () => {
  assert.match(loginPanel, /浙ICP备2026063624号-1/);
  assert.match(loginPanel, /https:\/\/beian\.miit\.gov\.cn\//);
  assert.match(loginPanel, /浙公网安备33068102001425号/);
  assert.match(loginPanel, /https:\/\/www\.beian\.gov\.cn\/portal\/registerSystemInfo\?recordcode=33068102001425/);
  assert.doesNotMatch(loginPanel, /beian\.mps\.gov\.cn/);
  assert.match(loginPanel, /aria-label="网站备案信息"/);
  assert.match(loginPanel, /rel="noopener noreferrer"/);
  assert.match(loginPanel, /import Image from "next\/image"/);
  assert.match(loginPanel, /src="\/icp-beian\.png"/);
  assert.match(loginPanel, /src="\/gongan\.png"/);
  assert.match(loginPanel, /loginFilingIcon/);
  assert.doesNotMatch(loginPanel, /loginIcpMark/);
  assert.match(loginStyles, /\.loginFooter nav/);
  assert.match(loginStyles, /\.loginFooter a:focus-visible/);
  assert.match(loginStyles, /\.loginScreen \{ height: 100dvh; \}/);
  assert.match(filingStyles, /\.loginFilingLink/);
  assert.match(filingStyles, /font-size:\s*14px/);
  assert.match(filingStyles, /\.loginFilingIcon/);
  assert.match(filingStyles, /width:\s*22px/);
  assert.match(filingStyles, /height:\s*22px/);
  assert.doesNotMatch(filingStyles, /\.loginIcpMark/);
  assert.equal(icpIcon.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(icpIcon.readUInt32BE(16), 32);
  assert.equal(icpIcon.readUInt32BE(20), 32);
});
