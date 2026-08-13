import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
};
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const releaseWorkflow = readFileSync(".github/workflows/github-release.yml", "utf8");
const installation = readFileSync("docs/INSTALLATION.md", "utf8");

test("Tencent Cloud production builds compile without applying database migrations", () => {
  assert.equal(packageJson.scripts?.build, "npm run build:app");
  assert.doesNotMatch(String(packageJson.scripts?.build), /db:deploy|prisma\s+migrate\s+deploy/);
  assert.equal(existsSync(".github/workflows/vercel-deploy.yml"), false);
  assert.equal(existsSync("vercel.json"), false);
});

test("migrations remain explicit while CI builds stay migration-free", () => {
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

test("GitHub is the release archive and Tencent Cloud keeps no code backup", () => {
  assert.match(installation, /每个正式发布版本都必须在 GitHub 保存 commit、Git tag 和 GitHub Release/);
  assert.match(installation, /腾讯云 CVM 不保存源码压缩包、旧 release 目录或代码版本备份/);
  assert.match(installation, /数据库备份和附件保护属于业务数据安全措施/);
  assert.match(releaseWorkflow, /tags:[\s\S]*v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.doesNotMatch(releaseWorkflow, /vercel|ssh|scp/i);
});
