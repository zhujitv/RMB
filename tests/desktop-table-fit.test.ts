import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellFrameCss = readFileSync("app/styles/workspace-shell/shell-frame-layout.module.css", "utf8");
const shellNavigationCss = readFileSync("app/styles/workspace-shell/shell-sidebar-navigation.module.css", "utf8");

test("medium desktop mode reclaims width for 1920x1080 displays using OS scaling", () => {
  assert.match(
    shellFrameCss,
    /@media \(min-width: 861px\) and \(max-width: 1535px\) \{[\s\S]*?\.appShell \{[\s\S]*?grid-template-columns: 220px minmax\(0, 1fr\);/,
  );
  assert.match(
    shellNavigationCss,
    /@media \(min-width: 861px\) and \(max-width: 1535px\) \{[\s\S]*?\.content \{[\s\S]*?padding: 20px;[\s\S]*?\.welcomeCard,[\s\S]*?\.moduleCard \{[\s\S]*?padding: 20px;/,
  );
});

test("medium desktop mode does not replace the existing mobile breakpoint", () => {
  assert.doesNotMatch(shellFrameCss, /@media \(max-width: 860px\)[\s\S]*?grid-template-columns: 220px/);
  assert.doesNotMatch(shellNavigationCss, /@media \(max-width: 860px\)[\s\S]*?padding: 20px/);
});
