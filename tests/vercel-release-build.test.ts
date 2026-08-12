import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
const releaseBuild = readFileSync("scripts/vercel-release-build.mjs", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("Vercel production builds compile without applying database migrations", () => {
  assert.equal(packageJson.scripts?.build, "node scripts/vercel-release-build.mjs");
  assert.doesNotMatch(releaseBuild, /VERCEL_TARGET_ENV|VERCEL_ENV/);
  assert.doesNotMatch(releaseBuild, /db:deploy|prisma\s+migrate\s+deploy/);
  assert.match(releaseBuild, /runNpmScript\("build:app"\)/);
});

test("migrations remain explicit while preview and CI builds stay migration-free", () => {
  assert.match(releaseBuild, /database migrations are intentionally skipped/);
  assert.equal(
    packageJson.scripts?.["build:release"],
    "node scripts/run-with-env.mjs prisma migrate deploy && npm run build:app",
  );
  assert.equal(
    packageJson.scripts?.["db:deploy"],
    "node scripts/run-with-env.mjs prisma migrate deploy",
  );
  assert.match(workflow, /npm run verify:ci/);
  assert.equal(packageJson.scripts?.["verify:ci"]?.includes("build:app"), true);
  assert.equal(packageJson.scripts?.["verify:ci"]?.includes("build:release"), false);
});
