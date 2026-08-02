import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const releaseBuild = readFileSync("scripts/vercel-release-build.mjs", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("Vercel production builds deploy migrations before compiling the application", () => {
  assert.equal(packageJson.scripts?.build, "node scripts/vercel-release-build.mjs");
  assert.match(releaseBuild, /target === "production"/);
  assert.match(releaseBuild, /runNpmScript\("db:deploy"\)/);
  assert.match(releaseBuild, /runNpmScript\("build:app"\)/);
  assert.ok(releaseBuild.indexOf('runNpmScript("db:deploy")') < releaseBuild.indexOf('runNpmScript("build:app")'));
});

test("preview and CI builds never apply production database migrations", () => {
  assert.match(releaseBuild, /database migrations are intentionally skipped/);
  assert.match(workflow, /npm run verify:ci/);
  assert.equal(packageJson.scripts?.["verify:ci"]?.includes("build:app"), true);
  assert.equal(packageJson.scripts?.["verify:ci"]?.includes("build:release"), false);
});
