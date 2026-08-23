import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const deployScript = resolve("scripts/deploy-cvm-quick.sh");
const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
const currentUser = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
const bashSupportsLowercaseExpansion = spawnSync(
  "bash",
  ["-c", "value=ABC; test \"${value,,}\" = abc"],
).status === 0;

function git(cwd: string, ...args: string[]) {
  return execFileSync(realGit, args, { cwd, encoding: "utf8" }).trim();
}

function writeExecutable(path: string, source: string) {
  writeFileSync(path, source, "utf8");
  chmodSync(path, 0o755);
}

function readLines(path: string) {
  return existsSync(path)
    ? readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)
    : [];
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "rmb-cvm-quick-deploy-"));
  const originDir = join(root, "origin.git");
  const seedDir = join(root, "seed");
  const appDir = join(root, "app");
  const binDir = join(root, "bin");
  const buildLog = join(root, "build.log");
  const fetchLog = join(root, "fetch.log");
  const restartLog = join(root, "restart.log");
  const auditFile = join(root, "audit.jsonl");
  const stateFile = join(root, "deploy.state");
  const meminfoFile = join(root, "meminfo");
  const loadavgFile = join(root, "loadavg");
  const executableDeployScript = join(root, "deploy-cvm-quick.sh");

  const deploySource = readFileSync(deployScript, "utf8");
  writeExecutable(
    executableDeployScript,
    bashSupportsLowercaseExpansion
      ? deploySource
      : deploySource.replace(
          'local path="$1" status="$2" lower="${1,,}"',
          'local path="$1" status="$2" lower\n  lower="$(printf \'%s\' "$path" | tr \'[:upper:]\' \'[:lower:]\')"',
        ),
  );

  mkdirSync(seedDir);
  mkdirSync(binDir);
  git(root, "init", "--bare", originDir);
  git(seedDir, "init", "-b", "main");
  git(seedDir, "config", "user.email", "deploy-test@nextwood.net");
  git(seedDir, "config", "user.name", "Deploy Test");
  mkdirSync(join(seedDir, "app"));
  mkdirSync(join(seedDir, "scripts"));
  writeFileSync(
    join(seedDir, ".gitignore"),
    "node_modules/\n.next/\n.rmb-deployed-sha\n.rmb-quick-*\n",
    "utf8",
  );
  writeFileSync(join(seedDir, "app", "feature.ts"), "export const value = 'base';\n", "utf8");
  writeFileSync(
    join(seedDir, "scripts", "security-env-check.mjs"),
    'import { appendFileSync } from "node:fs";\nappendFileSync(process.env.MOCK_BUILD_LOG, "security check\\n");\n',
    "utf8",
  );
  git(seedDir, "add", ".");
  git(seedDir, "commit", "-m", "base");
  const baseSha = git(seedDir, "rev-parse", "HEAD");
  git(seedDir, "remote", "add", "origin", originDir);
  git(seedDir, "push", "-u", "origin", "main");
  git(root, "clone", "--branch", "main", originDir, appDir);

  writeFileSync(join(seedDir, "app", "feature.ts"), "export const value = 'target';\n", "utf8");
  git(seedDir, "add", "app/feature.ts");
  git(seedDir, "commit", "-m", "target");
  const targetSha = git(seedDir, "rev-parse", "HEAD");
  git(seedDir, "push", "origin", "main");

  mkdirSync(join(appDir, "node_modules"));
  mkdirSync(join(appDir, "node_modules", ".bin"));
  mkdirSync(join(appDir, "node_modules", "fixture"));
  mkdirSync(join(appDir, "node_modules", "@scope", "example"), { recursive: true });
  writeFileSync(join(appDir, "node_modules", "fixture", "index.js"), "module.exports = 'fixture';\n", "utf8");
  writeFileSync(
    join(appDir, "node_modules", "@scope", "example", "index.js"),
    "module.exports = 'scoped fixture';\n",
    "utf8",
  );
  mkdirSync(join(appDir, ".next"));
  mkdirSync(join(appDir, ".next", "node_modules"));
  symlinkSync(
    "../../node_modules/fixture",
    join(appDir, ".next", "node_modules", "fixture-base-1234567890abcdef"),
  );
  writeFileSync(join(appDir, ".next", "BUILD_ID"), "old-build\n", "utf8");
  writeFileSync(join(appDir, ".next", "RMB_DEPLOY_SHA"), `${baseSha}\n`, "utf8");
  writeFileSync(join(appDir, ".rmb-deployed-sha"), `${baseSha}\n`, "utf8");
  writeFileSync(meminfoFile, "MemAvailable:       8388608 kB\n", "utf8");
  writeFileSync(loadavgFile, "0.10 0.10 0.10 1/100 1\n", "utf8");

  writeExecutable(join(binDir, "git"), `#!/bin/sh
set -eu
if [ "\${1:-}" = "remote" ] && [ "\${2:-}" = "get-url" ]; then
  printf '%s\n' 'git@github.com:zhujitv/RMB.git'
  exit 0
fi
if [ "\${1:-}" = "fetch" ]; then
  printf 'fetch\n' >> "$MOCK_FETCH_LOG"
  fetch_count="$(wc -l < "$MOCK_FETCH_LOG" | tr -d ' ')"
  if [ "$fetch_count" -le "\${MOCK_FETCH_FAIL_COUNT:-0}" ]; then
    printf '%s\n' "\${MOCK_FETCH_FAIL_MESSAGE:-fatal: unable to access repository: Empty reply from server}" >&2
    exit "\${MOCK_FETCH_FAIL_STATUS:-1}"
  fi
  exec "$REAL_GIT_BIN" fetch --no-tags --force "$MOCK_ORIGIN_PATH" main:refs/remotes/origin/main
fi
exec "$REAL_GIT_BIN" "$@"
`);

  writeExecutable(join(binDir, "npm"), `#!/bin/sh
set -eu
exit 99
`);

  writeExecutable(join(appDir, "node_modules", ".bin", "prisma"), `#!/bin/sh
set -eu
printf 'prisma %s\n' "$*" >> "$MOCK_BUILD_LOG"
if [ "\${MOCK_BUILD_FAIL:-0}" = "1" ]; then exit 42; fi
`);

  writeExecutable(join(appDir, "node_modules", ".bin", "next"), `#!/bin/sh
set -eu
printf 'next %s\n' "$*" >> "$MOCK_BUILD_LOG"
mkdir -p .next
printf 'new-build\n' > .next/BUILD_ID
mkdir -p .next/node_modules/@scope
ln -s ../../../node_modules/fixture .next/node_modules/fixture-1234567890abcdef
ln -s ../../../../node_modules/@scope/example .next/node_modules/@scope/example-1234567890abcdef
if [ "\${MOCK_BUILD_UNSAFE_LINK:-0}" = "1" ]; then
  ln -s "$MOCK_UNSAFE_LINK_TARGET" .next/node_modules/unsafe-1234567890abcdef
fi
`);

  writeExecutable(join(binDir, "curl"), `#!/bin/sh
set -eu
version="$(tr -d '\\r\\n' < "$MOCK_APP_DIR/.next/RMB_DEPLOY_SHA")"
printf '{"status":"ok","version":"%s"}\n' "$version"
`);

  writeExecutable(join(binDir, "systemctl"), `#!/bin/sh
set -eu
case "\${1:-}" in
  show)
    case "$*" in
      *EnvironmentFiles*) printf '%s\n' "$MOCK_EXPECTED_ENV_FILE" ;;
      *WorkingDirectory*) printf '%s\n' "$MOCK_APP_DIR" ;;
    esac
    ;;
  is-active) exit 0 ;;
  restart)
    printf 'restart\n' >> "$MOCK_RESTART_LOG"
    count="$(wc -l < "$MOCK_RESTART_LOG" | tr -d ' ')"
    if [ "\${MOCK_RESTART_FAIL_ONCE:-0}" = "1" ] && [ "$count" = "1" ]; then
      exit 1
    fi
    ;;
esac
`);

  writeExecutable(join(binDir, "sudo"), `#!/bin/sh
set -eu
if [ "\${1:-}" = "-n" ]; then shift; fi
if [ "\${1:-}" = "-l" ]; then exit 0; fi
exec "$@"
`);

  writeExecutable(join(binDir, "timeout"), `#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    --signal=*|--kill-after=*) shift ;;
    *[0-9]s|*[0-9]m|*[0-9]h) shift; break ;;
    *) break ;;
  esac
done
exec "$@"
`);

  writeExecutable(join(binDir, "sleep"), `#!/bin/sh
set -eu
exit 0
`);

  writeExecutable(join(binDir, "nice"), `#!/bin/sh
set -eu
if [ "\${1:-}" = "-n" ]; then shift 2; fi
exec "$@"
`);

  writeExecutable(join(binDir, "ionice"), `#!/bin/sh
set -eu
if [ "\${1:-}" = "-c" ]; then shift 2; fi
exec "$@"
`);

  writeExecutable(join(binDir, "python3"), `#!/bin/sh
set -eu
[ "\${1:-}" = "-" ] || exit 64
shift
left="$1"
right="$2"
temporary="$left.exchange.$$"
mv "$left" "$temporary"
mv "$right" "$left"
mv "$temporary" "$right"
if [ "\${MOCK_BREAK_ACTIVE_LINK_AFTER_EXCHANGE:-0}" = "1" ] && [ "$left" = "$MOCK_APP_DIR/.next" ]; then
  active_alias="$left/node_modules/fixture-1234567890abcdef"
  if [ -L "$active_alias" ]; then
    rm -f "$active_alias"
    ln -s ../../node_modules/missing-fixture "$active_alias"
  fi
fi
`);

  writeExecutable(join(binDir, "df"), `#!/bin/sh
set -eu
printf '%s\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on'
printf '%s\n' 'mock 9999999 1 9999998 1% /'
`);

  writeExecutable(join(binDir, "du"), `#!/bin/sh
set -eu
printf '10 %s\n' "\${2:-mock}"
`);

  writeExecutable(join(binDir, "flock"), `#!/bin/sh
set -eu
if [ "\${MOCK_FLOCK_BUSY:-0}" = "1" ]; then exit 1; fi
exit 0
`);

  writeExecutable(join(binDir, "mountpoint"), `#!/bin/sh
set -eu
exit 1
`);

  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ""}`,
    REAL_GIT_BIN: realGit,
    MOCK_ORIGIN_PATH: originDir,
    MOCK_APP_DIR: appDir,
    MOCK_BUILD_LOG: buildLog,
    MOCK_FETCH_LOG: fetchLog,
    MOCK_RESTART_LOG: restartLog,
    MOCK_EXPECTED_ENV_FILE: "/srv/rmb/shared/app.env",
    RMB_APP_DIR: appDir,
    RMB_SERVICE: "rmb-app.service",
    RMB_EXPECTED_ENV_FILE: "/srv/rmb/shared/app.env",
    RMB_DEPLOY_SHA: targetSha,
    RMB_READY_URL: "http://127.0.0.1:3000/api/health",
    RMB_PUBLIC_READY_URL: "https://www.nextwood.net/api/health",
    RMB_AUDIT_FILE: auditFile,
    RMB_STATE_FILE: stateFile,
    RMB_MEMINFO_FILE: meminfoFile,
    RMB_LOADAVG_FILE: loadavgFile,
    RMB_DEPLOY_ACTOR: "deploy-test",
    RMB_DEPLOY_RUN_URL: "https://github.com/zhujitv/RMB/actions/runs/1",
    RMB_EXPECTED_DEPLOY_USER: currentUser,
  };

  return {
    root,
    appDir,
    baseSha,
    targetSha,
    buildLog,
    fetchLog,
    restartLog,
    auditFile,
    stateFile,
    deployScript: executableDeployScript,
    env,
  };
}

type Fixture = ReturnType<typeof createFixture>;

function runDeploy(
  fixture: Fixture,
  overrides: Record<string, string | undefined> = {},
) {
  return spawnSync("bash", [fixture.deployScript], {
    cwd: fixture.appDir,
    encoding: "utf8",
    env: { ...fixture.env, ...overrides },
  });
}

function onlineState(fixture: Fixture) {
  return {
    head: git(fixture.appDir, "rev-parse", "HEAD"),
    marker: readFileSync(join(fixture.appDir, ".rmb-deployed-sha"), "utf8").trim(),
    buildSha: readFileSync(join(fixture.appDir, ".next", "RMB_DEPLOY_SHA"), "utf8").trim(),
    buildId: readFileSync(join(fixture.appDir, ".next", "BUILD_ID"), "utf8").trim(),
    source: readFileSync(join(fixture.appDir, "app", "feature.ts"), "utf8").trim(),
  };
}

function assertBaseDependencyAlias(fixture: Fixture) {
  const alias = join(
    fixture.appDir,
    ".next",
    "node_modules",
    "fixture-base-1234567890abcdef",
  );
  assert.equal(readlinkSync(alias), "../../node_modules/fixture");
  assert.equal(realpathSync(alias), realpathSync(join(fixture.appDir, "node_modules", "fixture")));
}

function cleanupFixture(fixture: Fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
}

test("quick deploy switches source and build, then records the target marker", () => {
  const fixture = createFixture();
  try {
    const result = runDeploy(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(onlineState(fixture), {
      head: fixture.targetSha,
      marker: fixture.targetSha,
      buildSha: fixture.targetSha,
      buildId: "new-build",
      source: "export const value = 'target';",
    });
    assert.deepEqual(readLines(fixture.fetchLog), ["fetch"]);
    assert.deepEqual(readLines(fixture.buildLog), [
      "security check",
      "prisma generate",
      "next build",
    ]);
    assert.deepEqual(readLines(fixture.restartLog), ["restart"]);
    assert.equal(existsSync(fixture.stateFile), false);
    assert.equal(statSync(join(fixture.appDir, ".next")).mode & 0o777, 0o755);
    assert.equal(statSync(join(fixture.appDir, ".next", "BUILD_ID")).mode & 0o777, 0o644);
    assert.equal(statSync(join(fixture.appDir, ".next", "RMB_DEPLOY_SHA")).mode & 0o777, 0o644);
    const regularAlias = join(fixture.appDir, ".next", "node_modules", "fixture-1234567890abcdef");
    const scopedAlias = join(
      fixture.appDir,
      ".next",
      "node_modules",
      "@scope",
      "example-1234567890abcdef",
    );
    assert.equal(readlinkSync(regularAlias), "../../node_modules/fixture");
    assert.equal(readlinkSync(scopedAlias), "../../../node_modules/@scope/example");
    assert.equal(realpathSync(regularAlias), realpathSync(join(fixture.appDir, "node_modules", "fixture")));
    assert.equal(
      realpathSync(scopedAlias),
      realpathSync(join(fixture.appDir, "node_modules", "@scope", "example")),
    );
    const audit = readLines(fixture.auditFile).map((line) => JSON.parse(line));
    assert.deepEqual(audit.map((entry) => entry.status), ["STARTED", "SUCCESS"]);
  } finally {
    cleanupFixture(fixture);
  }
});

test("transient origin fetch failures are retried before deployment continues", () => {
  const fixture = createFixture();
  try {
    const result = runDeploy(fixture, {
      MOCK_FETCH_FAIL_COUNT: "2",
      MOCK_FETCH_FAIL_MESSAGE: "fatal: unable to access repository: Empty reply from server",
      MOCK_FETCH_FAIL_STATUS: "128",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readLines(fixture.fetchLog), ["fetch", "fetch", "fetch"]);
    assert.match(result.stdout, /fetch attempt 1\/3 failed with a transient network error/);
    assert.match(result.stdout, /fetch attempt 2\/3 failed with a transient network error/);
    assert.deepEqual(readLines(fixture.restartLog), ["restart"]);
    assert.equal(onlineState(fixture).head, fixture.targetSha);
  } finally {
    cleanupFixture(fixture);
  }
});

test("a bounded origin fetch timeout is retried once connectivity returns", () => {
  const fixture = createFixture();
  try {
    const result = runDeploy(fixture, {
      MOCK_FETCH_FAIL_COUNT: "1",
      MOCK_FETCH_FAIL_MESSAGE: "fetch operation exceeded its time budget",
      MOCK_FETCH_FAIL_STATUS: "124",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readLines(fixture.fetchLog), ["fetch", "fetch"]);
    assert.match(result.stdout, /fetch attempt 1\/3 failed with a transient network error/);
    assert.equal(onlineState(fixture).head, fixture.targetSha);
  } finally {
    cleanupFixture(fixture);
  }
});

test("three transient origin fetch failures stop before build or restart", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    const result = runDeploy(fixture, {
      MOCK_FETCH_FAIL_COUNT: "3",
      MOCK_FETCH_FAIL_MESSAGE: "fatal: unable to access repository: Empty reply from server",
      MOCK_FETCH_FAIL_STATUS: "128",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot refresh origin\/main after 3 transient network attempts/);
    assert.deepEqual(readLines(fixture.fetchLog), ["fetch", "fetch", "fetch"]);
    assert.deepEqual(readLines(fixture.buildLog), []);
    assert.deepEqual(readLines(fixture.restartLog), []);
    assert.deepEqual(onlineState(fixture), before);
  } finally {
    cleanupFixture(fixture);
  }
});

test("non-transient origin fetch failures are not retried", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    const result = runDeploy(fixture, {
      MOCK_FETCH_FAIL_COUNT: "3",
      MOCK_FETCH_FAIL_MESSAGE: "fatal: Authentication failed for repository",
      MOCK_FETCH_FAIL_STATUS: "128",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Authentication failed/);
    assert.match(result.stderr, /non-transient fetch failure on attempt 1\/3/);
    assert.deepEqual(readLines(fixture.fetchLog), ["fetch"]);
    assert.deepEqual(readLines(fixture.buildLog), []);
    assert.deepEqual(readLines(fixture.restartLog), []);
    assert.deepEqual(onlineState(fixture), before);
  } finally {
    cleanupFixture(fixture);
  }
});

test("candidate build failure leaves the online source and build untouched without restart", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    const result = runDeploy(fixture, { MOCK_BUILD_FAIL: "1" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(onlineState(fixture), before);
    assert.deepEqual(readLines(fixture.fetchLog), ["fetch"]);
    assert.deepEqual(readLines(fixture.buildLog), ["security check", "prisma generate"]);
    assert.deepEqual(readLines(fixture.restartLog), []);
    assert.equal(existsSync(fixture.stateFile), false);
  } finally {
    cleanupFixture(fixture);
  }
});

test("an external candidate dependency link is rejected before activation or restart", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    const result = runDeploy(fixture, {
      MOCK_BUILD_UNSAFE_LINK: "1",
      MOCK_UNSAFE_LINK_TARGET: fixture.root,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /outside the approved dependency tree/);
    assert.match(result.stderr, /candidate build dependency links cannot be safely relocated/);
    assert.deepEqual(readLines(fixture.restartLog), []);
    assert.deepEqual(onlineState(fixture), before);
    assert.equal(existsSync(fixture.stateFile), false);
  } finally {
    cleanupFixture(fixture);
  }
});

test("a dependency link broken during activation is rolled back before the new service starts", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    const result = runDeploy(fixture, { MOCK_BREAK_ACTIVE_LINK_AFTER_EXCHANGE: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /activated build contains a missing or unsafe dependency link/);
    assert.deepEqual(onlineState(fixture), before);
    assert.deepEqual(readLines(fixture.restartLog), ["restart"]);
    assert.equal(existsSync(fixture.stateFile), false);
    const audit = readLines(fixture.auditFile).map((line) => JSON.parse(line));
    assert.equal(audit.at(-1)?.status, "FAILED");
    assert.equal(audit.at(-1)?.rolledBack, true);
  } finally {
    cleanupFixture(fixture);
  }
});

test("insufficient free memory stops before candidate build or service restart", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    writeFileSync(join(fixture.root, "meminfo"), "MemAvailable:       2097152 kB\n", "utf8");
    const result = runDeploy(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /less than 6144 MiB memory is available/);
    assert.deepEqual(onlineState(fixture), before);
    assert.deepEqual(readLines(fixture.buildLog), []);
    assert.deepEqual(readLines(fixture.restartLog), []);
    assert.equal(existsSync(fixture.stateFile), false);
  } finally {
    cleanupFixture(fixture);
  }
});

test("an unmanageable live build stops before candidate fetch or build", () => {
  const fixture = createFixture();
  const liveBuild = join(fixture.appDir, ".next");
  try {
    const before = onlineState(fixture);
    chmodSync(liveBuild, 0o555);
    const result = runDeploy(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /current production build contains a directory/);
    assert.deepEqual(onlineState(fixture), before);
    assert.deepEqual(readLines(fixture.fetchLog), []);
    assert.deepEqual(readLines(fixture.buildLog), []);
    assert.deepEqual(readLines(fixture.restartLog), []);
  } finally {
    if (existsSync(liveBuild)) chmodSync(liveBuild, 0o755);
    cleanupFixture(fixture);
  }
});

test("restart failure restores the base source, build and deployed marker", () => {
  const fixture = createFixture();
  try {
    const result = runDeploy(fixture, { MOCK_RESTART_FAIL_ONCE: "1" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(onlineState(fixture), {
      head: fixture.baseSha,
      marker: fixture.baseSha,
      buildSha: fixture.baseSha,
      buildId: "old-build",
      source: "export const value = 'base';",
    });
    assertBaseDependencyAlias(fixture);
    assert.deepEqual(readLines(fixture.restartLog), ["restart", "restart"]);
    assert.equal(existsSync(fixture.stateFile), false);
    const audit = readLines(fixture.auditFile).map((line) => JSON.parse(line));
    assert.equal(audit.at(-1)?.status, "FAILED");
    assert.equal(audit.at(-1)?.rolledBack, true);
  } finally {
    cleanupFixture(fixture);
  }
});

for (const interruptedPhase of ["EXCHANGED", "SOURCE_SWITCHED"] as const) {
  test(`a later run recovers an interrupted ${interruptedPhase} deployment before rebuilding`, () => {
    const fixture = createFixture();
    try {
      const interruptedCandidate = join(fixture.appDir, ".rmb-quick-build-interrupted");
      git(fixture.appDir, "fetch", "origin", "main");
      git(fixture.appDir, "worktree", "add", "--detach", interruptedCandidate, "origin/main");
      mkdirSync(join(interruptedCandidate, ".next"), { recursive: true });
      mkdirSync(join(interruptedCandidate, ".next", "node_modules"));
      symlinkSync(
        "../../node_modules/fixture",
        join(interruptedCandidate, ".next", "node_modules", "fixture-base-1234567890abcdef"),
      );
      writeFileSync(join(interruptedCandidate, ".next", "BUILD_ID"), "old-build\n", "utf8");
      writeFileSync(
        join(interruptedCandidate, ".next", "RMB_DEPLOY_SHA"),
        `${fixture.baseSha}\n`,
        "utf8",
      );
      writeFileSync(join(fixture.appDir, ".next", "BUILD_ID"), "interrupted-new-build\n", "utf8");
      writeFileSync(join(fixture.appDir, ".next", "RMB_DEPLOY_SHA"), `${fixture.targetSha}\n`, "utf8");
      git(fixture.appDir, "merge", "--ff-only", "origin/main");
      writeFileSync(
        fixture.stateFile,
        `${interruptedPhase}\t${fixture.baseSha}\t${fixture.targetSha}\t${interruptedCandidate}\n`,
        "utf8",
      );

      const result = runDeploy(fixture, { MOCK_BUILD_FAIL: "1" });
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /recovering interrupted quick deployment/);
      assert.deepEqual(onlineState(fixture), {
        head: fixture.baseSha,
        marker: fixture.baseSha,
        buildSha: fixture.baseSha,
        buildId: "old-build",
        source: "export const value = 'base';",
      });
      assertBaseDependencyAlias(fixture);
      assert.deepEqual(readLines(fixture.restartLog), ["restart"]);
      assert.equal(existsSync(fixture.stateFile), false);
      assert.equal(existsSync(interruptedCandidate), false);
    } finally {
      cleanupFixture(fixture);
    }
  });
}

test("an occupied deployment lock rejects a second run before fetch or build", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    const result = runDeploy(fixture, { MOCK_FLOCK_BUSY: "1" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /another production deployment is already running/);
    assert.deepEqual(onlineState(fixture), before);
    assert.deepEqual(readLines(fixture.fetchLog), []);
    assert.deepEqual(readLines(fixture.buildLog), []);
    assert.deepEqual(readLines(fixture.restartLog), []);
    assert.equal(existsSync(fixture.stateFile), false);
  } finally {
    cleanupFixture(fixture);
  }
});

test("an unexpected deployment identity is rejected before fetch or build", () => {
  const fixture = createFixture();
  try {
    const before = onlineState(fixture);
    const result = runDeploy(fixture, { RMB_EXPECTED_DEPLOY_USER: `${currentUser}-other` });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /quick deployment must run as/);
    assert.deepEqual(onlineState(fixture), before);
    assert.deepEqual(readLines(fixture.fetchLog), []);
    assert.deepEqual(readLines(fixture.buildLog), []);
    assert.deepEqual(readLines(fixture.restartLog), []);
  } finally {
    cleanupFixture(fixture);
  }
});
