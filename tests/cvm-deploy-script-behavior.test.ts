import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const deployScript = resolve("scripts/deploy-cvm-from-bundle.sh");

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createFixture(restartFailsOnce: boolean, sourceAheadOfBuild = false) {
  const root = mkdtempSync(join(tmpdir(), "rmb-cvm-deploy-behavior-"));
  const appDir = join(root, "app");
  const buildRoot = join(root, "build");
  const binDir = join(root, "bin");
  mkdirSync(appDir);
  mkdirSync(buildRoot);
  mkdirSync(binDir);
  mkdirSync(join(appDir, ".next"));
  writeFileSync(join(appDir, ".next", "BUILD_ID"), "old-build\n", "utf8");
  writeJson(join(appDir, "package.json"), {
    name: "fixture",
    version: "1.0.0",
    dependencies: { fixture: "1.0.0" },
  });
  writeJson(join(appDir, "package-lock.json"), {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture", version: "1.0.0", dependencies: { fixture: "1.0.0" } },
      "node_modules/fixture": { version: "1.0.0" },
    },
  });
  writeFileSync(join(appDir, "application.txt"), "old-source\n", "utf8");

  git(appDir, "init", "-b", "deployed");
  git(appDir, "config", "user.email", "deploy-test@nextwood.net");
  git(appDir, "config", "user.name", "Deploy Test");
  git(appDir, "add", ".");
  git(appDir, "commit", "-m", "base");
  const baseSha = git(appDir, "rev-parse", "HEAD");
  let currentSha = baseSha;
  if (sourceAheadOfBuild) {
    writeFileSync(join(appDir, "application.txt"), "ahead-source-with-old-build\n", "utf8");
    git(appDir, "add", ".");
    git(appDir, "commit", "-m", "source advanced without build activation");
    currentSha = git(appDir, "rev-parse", "HEAD");
  }
  git(appDir, "switch", "-c", "target-work");

  writeJson(join(appDir, "package.json"), {
    name: "fixture",
    version: "1.0.1",
    dependencies: { fixture: "1.0.0" },
  });
  const targetLock = JSON.parse(readFileSync(join(appDir, "package-lock.json"), "utf8"));
  targetLock.version = "1.0.1";
  targetLock.packages[""].version = "1.0.1";
  writeJson(join(appDir, "package-lock.json"), targetLock);
  writeFileSync(join(appDir, "application.txt"), "new-source\n", "utf8");
  git(appDir, "add", ".");
  git(appDir, "commit", "-m", "target");
  const targetSha = git(appDir, "rev-parse", "HEAD");
  git(appDir, "branch", "deploy-target", targetSha);
  git(appDir, "switch", "deployed");

  const bundlePath = join(root, "deploy.bundle");
  git(appDir, "bundle", "create", bundlePath, "deploy-target", `^${currentSha}`);

  mkdirSync(join(buildRoot, ".next"));
  writeFileSync(join(buildRoot, ".next", "BUILD_ID"), "new-build\n", "utf8");
  writeFileSync(join(buildRoot, ".next", "RMB_DEPLOY_SHA"), `${targetSha}\n`, "utf8");
  const archivePath = join(root, "build.tar.gz");
  execFileSync("tar", ["-czf", archivePath, ".next"], { cwd: buildRoot });

  const restartState = join(root, "restart-state");
  const systemctlPath = join(binDir, "systemctl");
  writeFileSync(systemctlPath, `#!/usr/bin/env node
const { existsSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "show" && args.includes("--property=EnvironmentFiles")) {
  process.stdout.write("/srv/rmb/shared/app.env\\n");
} else if (args[0] === "show" && args.includes("--property=WorkingDirectory")) {
  process.stdout.write(process.env.MOCK_APP_DIR + "\\n");
} else if (args[0] === "restart" && process.env.MOCK_RESTART_FAIL_ONCE === "1" && !existsSync(process.env.MOCK_RESTART_STATE)) {
  writeFileSync(process.env.MOCK_RESTART_STATE, "failed-once");
  process.exit(1);
}
`, "utf8");
  chmodSync(systemctlPath, 0o755);

  const sudoPath = join(binDir, "sudo");
  writeFileSync(sudoPath, `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const [command, ...args] = process.argv.slice(2);
const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
`, "utf8");
  chmodSync(sudoPath, 0o755);

  const curlPath = join(binDir, "curl");
  writeFileSync(curlPath, `#!/usr/bin/env node
const url = process.argv.at(-1) || "";
if (url.endsWith("/api/health")) {
  process.stdout.write(JSON.stringify({ status: "ok", version: process.env.RMB_DEPLOY_SHA }));
}
process.exit(0);
`, "utf8");
  chmodSync(curlPath, 0o755);

  return {
    root,
    appDir,
    baseSha,
    currentSha,
    targetSha,
    bundlePath,
    archivePath,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ""}`,
      MOCK_APP_DIR: appDir,
      MOCK_RESTART_FAIL_ONCE: restartFailsOnce ? "1" : "0",
      MOCK_RESTART_STATE: restartState,
      RMB_SUDO: sudoPath,
      RMB_APP_DIR: appDir,
      RMB_SERVICE: "rmb-app.service",
      RMB_EXPECTED_ENV_FILE: "/srv/rmb/shared/app.env",
      RMB_DEPLOY_BUNDLE: bundlePath,
      RMB_BUILD_ARCHIVE: archivePath,
      RMB_DEPLOY_SHA: targetSha,
      RMB_BASE_DEPLOYED_SHA: baseSha,
      RMB_READY_URL: "http://127.0.0.1:3000/api/health",
      RMB_PUBLIC_READY_URL: "https://www.nextwood.net/api/health",
      RMB_ROLLBACK_HEALTH_URL: "http://127.0.0.1:3000/",
    },
  };
}

test("CVM deploy activates a verified build and records the deployed SHA", () => {
  const fixture = createFixture(false);
  try {
    execFileSync(deployScript, { cwd: fixture.appDir, env: fixture.env, stdio: "pipe" });
    assert.equal(git(fixture.appDir, "rev-parse", "HEAD"), fixture.targetSha);
    assert.equal(readFileSync(join(fixture.appDir, ".next", "BUILD_ID"), "utf8").trim(), "new-build");
    assert.equal(readFileSync(join(fixture.appDir, ".rmb-deployed-sha"), "utf8").trim(), fixture.targetSha);
    assert.equal(readFileSync(join(fixture.appDir, "application.txt"), "utf8").trim(), "new-source");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CVM deploy restores source and build when the new service cannot restart", () => {
  const fixture = createFixture(true);
  try {
    const result = spawnSync(deployScript, { cwd: fixture.appDir, env: fixture.env, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous release restored/);
    assert.equal(git(fixture.appDir, "rev-parse", "HEAD"), fixture.baseSha);
    assert.equal(readFileSync(join(fixture.appDir, ".next", "BUILD_ID"), "utf8").trim(), "old-build");
    assert.equal(readFileSync(join(fixture.appDir, "application.txt"), "utf8").trim(), "old-source");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CVM rollback restores the source matching the last successful build baseline", () => {
  const fixture = createFixture(true, true);
  try {
    assert.notEqual(fixture.currentSha, fixture.baseSha);
    const result = spawnSync(deployScript, { cwd: fixture.appDir, env: fixture.env, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous release restored/);
    assert.equal(git(fixture.appDir, "rev-parse", "HEAD"), fixture.baseSha);
    assert.equal(readFileSync(join(fixture.appDir, ".next", "BUILD_ID"), "utf8").trim(), "old-build");
    assert.equal(readFileSync(join(fixture.appDir, "application.txt"), "utf8").trim(), "old-source");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
