import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/deploy-cvm-quick.yml", "utf8");
const script = readFileSync("scripts/deploy-cvm-quick.sh", "utf8");
const fullDeployScript = readFileSync("scripts/deploy-cvm-from-bundle.sh", "utf8");
const docs = readFileSync("docs/CVM_QUICK_DEPLOYMENT_CHANNEL.md", "utf8");

test("quick deploy is one-click by default but resolves an exact current main SHA", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /default: "main"/);
  assert.match(workflow, /INPUT_REF: \$\{\{ inputs\.ref \}\}/);
  assert.match(workflow, /"\$INPUT_REF" == "main"/);
  assert.match(workflow, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(workflow, /main_sha="\$\(git rev-parse refs\/remotes\/origin\/main\)"/);
  assert.match(workflow, /"\$main_sha" == "\$checked_out_sha"/);
  assert.match(workflow, /head_sha=\$checked_out_sha&status=success/);
  assert.match(workflow, /printf 'sha=%s\\n' "\$checked_out_sha"/);
});

test("quick deploy shares the production lock and has bounded runtime", () => {
  assert.match(workflow, /group: rmb-cvm-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 35/);
  assert.match(script, /flock -n 9/);
  assert.match(script, /another production deployment is already running/);
  assert.match(script, /LOCK_FILE="\$APP_DIR\/\.rmb-production-deploy\.lock"/);
  assert.doesNotMatch(script, /RMB_DEPLOY_LOCK_FILE/);
  assert.doesNotMatch(workflow, /RMB_CVM_DEPLOY_LOCK_FILE|RMB_DEPLOY_LOCK_FILE/);
  assert.match(script, /exec timeout --signal=TERM --kill-after=3m 22m/);
  assert.match(script, /env RMB_QUICK_DEPLOY_UNDER_TIMEOUT=1 "\$0" "\$@"/);
  assert.doesNotMatch(script, /timeout --foreground/);
  assert.doesNotMatch(script, /timeout[^\n]*BUILD_PREFIX/);
  const timeoutIndex = script.indexOf("exec timeout --signal=TERM --kill-after=3m 22m");
  const flockIndex = script.indexOf('flock -n 9');
  assert.ok(timeoutIndex >= 0 && timeoutIndex < flockIndex, "timeout supervisor must start before the deployment lock is acquired");
  assert.doesNotMatch(workflow, /timeout[^\n]*"\$exec_file"/);
  assert.match(workflow, /ConnectTimeout=15/);
  assert.match(workflow, /ServerAliveInterval=15/);
  assert.match(workflow, /ServerAliveCountMax=3/);
});

test("quick deploy uses strict SSH and only transfers the checked bootstrap script", () => {
  assert.match(workflow, /RMB_CVM_SSH_KEY/);
  assert.match(workflow, /RMB_CVM_KNOWN_HOSTS/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(workflow, /ssh-keyscan|upload-artifact|download-artifact/);
  assert.match(workflow, /scp "\$\{scp_opts\[@\]\}" scripts\/deploy-cvm-quick\.sh "\$ssh_target:\$remote_upload"/);
  assert.doesNotMatch(workflow, /scp[^\n]*(?:\.next|tar\.gz|build artifact)/i);
  assert.match(workflow, /sha256sum scripts\/deploy-cvm-quick\.sh/);
  assert.match(workflow, /RMB_BOOTSTRAP_SHA256=%q/);
  assert.match(workflow, /actual_sha256/);
  assert.match(workflow, /Bootstrap script checksum mismatch/);
  assert.match(workflow, /cat-file -e HEAD:scripts\/deploy-cvm-quick\.sh/);
  assert.match(workflow, /show HEAD:scripts\/deploy-cvm-quick\.sh > "\$exec_file"/);
  assert.match(workflow, /cp -- "\$RMB_BOOTSTRAP_UPLOAD" "\$exec_file"/);
  assert.match(workflow, /exec_file="\$\(mktemp \/tmp\/rmb-cvm-quick-exec\.XXXXXX\)"/);
  const chmodIndex = workflow.indexOf('chmod 700 "$exec_file"');
  const syntaxIndex = workflow.indexOf('bash -n "$exec_file"');
  const executeIndex = workflow.indexOf('"$exec_file"', syntaxIndex + 1);
  assert.ok(chmodIndex >= 0);
  assert.ok(syntaxIndex > chmodIndex);
  assert.ok(executeIndex > syntaxIndex);
  assert.match(workflow, /"\$exec_file"/);
  assert.doesNotMatch(workflow, /\|\s*bash|bash -s|<\s*scripts\/deploy-cvm-quick\.sh/);
  assert.match(script, /GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes"/);
  assert.match(script, /origin must be the approved zhujitv\/RMB repository/);
});

test("independent public verification is short and bounded", () => {
  assert.match(workflow, /for attempt in \{1\.\.10\}/);
  assert.match(workflow, /curl --fail --silent --show-error --max-time 5 "\$public_url"/);
  assert.doesNotMatch(workflow, /for attempt in \{1\.\.20\}|--max-time 20 "\$public_url"/);
});

test("server fetches main before accepting the exact SHA", () => {
  const mainFetch = script.indexOf("git fetch --no-tags --force origin main:refs/remotes/origin/main");
  const mainEquality = script.indexOf('"$(git rev-parse refs/remotes/origin/main)" == "$TARGET_SHA"');
  assert.ok(mainFetch >= 0);
  assert.ok(mainEquality > mainFetch);
  assert.match(script, /git cat-file -e "\$TARGET_SHA\^\{commit\}"/);
  assert.doesNotMatch(script, /git fetch --no-tags origin "\$TARGET_SHA"/);
  assert.match(script, /git merge-base --is-ancestor "\$BASE_SHA" "\$TARGET_SHA"/);
  assert.match(script, /CVM already runs the current main SHA; nothing to deploy/);
});

test("quick eligibility blocks protected changes from the online SHA", () => {
  assert.match(script, /CURRENT_HEAD" == "\$BASE_SHA" && "\$BUILD_SHA" == "\$BASE_SHA/);
  assert.match(script, /git diff --no-renames --name-status -z "\$BASE_SHA" "\$TARGET_SHA"/);
  assert.match(script, /\.github\/\*\|\.circleci\/\*\|\.gitlab-ci\*\|scripts\/\*\|prisma\/\*/);
  assert.match(script, /package\*\.json\|\*\/package\*\.json/);
  assert.match(script, /package-lock\.json/);
  assert.match(script, /\.env\|\.env\.\*/);
  assert.match(script, /next\.config\.\*/);
  assert.match(script, /proxy\.ts\|middleware\.ts/);
  assert.match(script, /app\/api\/health\/route\.ts/);
  assert.match(script, /app\/api\/auth\/\*/);
  assert.match(script, /app\/api\/cron\/\*/);
  assert.match(script, /\[\[ "\$BOOTSTRAP_MODE" == "1" && "\$status" == "A" \]\] && return 1/);
  assert.match(script, /changed_count <= 60/);
  assert.match(script, /line_churn <= 5000/);
  assert.match(script, /binary changes require the full deployment channel/);
  assert.match(script, /symlink or gitlink changes require the full deployment channel/);
  assert.match(script, /control characters in changed paths require the full deployment channel/);
  assert.match(script, /git diff --check "\$BASE_SHA" "\$TARGET_SHA"/);
  assert.match(script, /RMB_BOOTSTRAP_BASE_SCRIPT="\$bootstrap_base_script"/);
  assert.match(script, /RMB_BOOTSTRAP_FULL_SCRIPT="\$bootstrap_full_script"/);
  assert.match(script, /function replaceOnce/);
  assert.match(script, /source\.indexOf\(anchor, first \+ anchor\.length\) >= 0/);
  assert.match(script, /target !== expected/);
});

test("bootstrap validator permits only the exact approved lock transform", () => {
  const validatorStart = script.indexOf('const base = process.env.RMB_BOOTSTRAP_BASE_SCRIPT || "";');
  const validatorEnd = script.indexOf("\nNODE\nfi", validatorStart);
  assert.ok(validatorStart >= 0 && validatorEnd > validatorStart, "bootstrap validator must be extractable");
  const validator = script.slice(validatorStart, validatorEnd);
  const baseFullDeployScript = execFileSync(
    "git",
    ["show", "HEAD:scripts/deploy-cvm-from-bundle.sh"],
    { encoding: "utf8" },
  ).trimEnd();
  const env = {
    ...process.env,
    RMB_BOOTSTRAP_BASE_SCRIPT: baseFullDeployScript,
    RMB_BOOTSTRAP_FULL_SCRIPT: fullDeployScript.trimEnd(),
  };
  assert.equal(spawnSync(process.execPath, ["-e", validator], { env }).status, 0);

  const acquisition = [
    'mkdir -p "$(dirname "$LOCK_FILE")"',
    'exec 9>"$LOCK_FILE"',
    'flock -n 9 || fail "another production deployment is already running"',
    "",
  ].join("\n");
  const misplaced = `${fullDeployScript.trimEnd().replace(acquisition.trimEnd(), "")}\n${acquisition.trimEnd()}`;
  const invalid = spawnSync(process.execPath, ["-e", validator], {
    env: { ...env, RMB_BOOTSTRAP_FULL_SCRIPT: misplaced },
  });
  assert.notEqual(invalid.status, 0, "lock lines outside the activation preflight must be rejected");

  const hiddenIncrement = spawnSync(process.execPath, ["-e", validator], {
    env: {
      ...env,
      RMB_BOOTSTRAP_FULL_SCRIPT: `${fullDeployScript.trimEnd()}\n++counter;`,
    },
  });
  assert.notEqual(hiddenIncrement.status, 0, "an extra line beginning with ++ must not bypass bootstrap validation");
});

test("server builds in an isolated worktree without reinstalling dependencies", () => {
  assert.match(script, /git worktree add --detach "\$CANDIDATE_DIR" "\$TARGET_SHA"/);
  assert.match(script, /ln -s "\$APP_DIR\/node_modules" "\$CANDIDATE_DIR\/node_modules"/);
  assert.match(script, /RMB_SKIP_LOCAL_ENV_FILES=1/);
  assert.match(script, /SECURITY_BUILD_MODE=preview/);
  assert.match(script, /node scripts\/security-env-check\.mjs/);
  assert.match(script, /\.\/node_modules\/\.bin\/prisma generate/);
  assert.match(script, /\.\/node_modules\/\.bin\/next build/);
  assert.doesNotMatch(script, /npm (?:ci|install)/);
  assert.match(script, /printf '%s\\n' "\$TARGET_SHA" > \.next\/RMB_DEPLOY_SHA/);

  const securityCheck = script.indexOf("node scripts/security-env-check.mjs");
  const prismaGenerate = script.indexOf("./node_modules/.bin/prisma generate");
  const nextBuild = script.indexOf("./node_modules/.bin/next build");
  assert.ok(securityCheck >= 0);
  assert.ok(prismaGenerate > securityCheck);
  assert.ok(nextBuild > prismaGenerate);
});

test("server preflights build resources and lowers candidate build priority", () => {
  assert.match(script, /MEMINFO_FILE="\$\{RMB_MEMINFO_FILE:-\/proc\/meminfo\}"/);
  assert.match(script, /LOADAVG_FILE="\$\{RMB_LOADAVG_FILE:-\/proc\/loadavg\}"/);
  assert.match(script, /MemAvailable:/);
  assert.match(script, /BUILD_HEAP_MB=1024/);
  assert.match(script, /MIN_AVAILABLE_MB=\$\(\(BUILD_HEAP_MB \* 3\)\)/);
  assert.match(script, /available_mb >= MIN_AVAILABLE_MB/);
  assert.match(script, /df -Pm "\$APP_DIR"/);
  assert.match(script, /du -sm "\$APP_DIR\/\.next"/);
  assert.match(script, /required_disk_mb >= 2048/);
  assert.match(script, /load > Math\.max\(2, cpu \* 2\)/);
  assert.match(script, /BUILD_PREFIX=\(nice -n 10\)/);
  assert.match(script, /BUILD_PREFIX=\(ionice -c 3 nice -n 10\)/);
  assert.match(script, /CIRCLE_NODE_TOTAL=1/);
  assert.match(script, /NODE_OPTIONS="--max-old-space-size=\$BUILD_HEAP_MB"/);
});

test("quick eligibility rejects newly introduced runtime environment names", () => {
  assert.match(script, /New runtime environment variable names/);
  assert.match(script, /new runtime environment variables require the full deployment channel/);
});

test("activation is transactional, health-gated, audited and automatically reversible", () => {
  const prepared = script.indexOf("write_state PREPARED");
  const switchBuild = script.indexOf('exchange_builds "$APP_DIR/.next" "$CANDIDATE_DIR/.next"');
  const exchanged = script.indexOf("write_state EXCHANGED");
  const restart = script.indexOf('"${RESTART_CMD[@]}" restart "$SERVICE"', switchBuild);
  const restarted = script.indexOf("write_state RESTARTED");
  const localHealth = script.indexOf('check_health "$LOCAL_URL" "$TARGET_SHA" "local"');
  const publicHealth = script.indexOf('check_health "$PUBLIC_URL" "$TARGET_SHA" "public"');
  const switchSource = script.indexOf('git merge --ff-only "$TARGET_SHA"');
  const sourceSwitched = script.indexOf("write_state SOURCE_SWITCHED");
  const marker = script.indexOf('write_marker "$TARGET_SHA"');
  assert.ok(prepared >= 0);
  assert.ok(switchBuild > prepared);
  assert.ok(exchanged > switchBuild);
  assert.ok(restart > exchanged);
  assert.ok(restarted > restart);
  assert.ok(localHealth > restarted);
  assert.ok(publicHealth > localHealth);
  assert.ok(switchSource > publicHealth);
  assert.ok(sourceSwitched > switchSource);
  assert.ok(marker > sourceSwitched);
  assert.match(script, /exchange_builds\(\)/);
  assert.match(script, /renameat2/);
  assert.match(script, /rollback_to\(\)/);
  assert.match(script, /exchange_builds "\$APP_DIR\/\.next" "\$candidate\/\.next"/);
  assert.match(script, /restore_source_to "\$base"/);
  assert.match(script, /check_health "\$LOCAL_URL" "\$base" "rollback"/);
  assert.match(script, /STATE_FILE="\$\{RMB_STATE_FILE:-\$APP_DIR\/\.rmb-quick-deploy-state\}"/);
  assert.match(script, /recover_pending\(\)/);
  assert.match(script, /\^\(PREPARED\|EXCHANGED\|RESTARTED\|SOURCE_SWITCHED\)\$/);
  assert.ok(script.indexOf("recover_pending") < script.indexOf("CURRENT_HEAD="));
  assert.match(script, /\[\[ -f "\$STATE_FILE" \]\]/);
  assert.match(script, /audit_event "STARTED"/);
  assert.match(script, /audit_event "SUCCESS"/);
  assert.match(script, /audit_event "FAILED"/);
  assert.match(script, /changedFiles: files/);
});

test("quick deployment shell and operator guide remain valid", () => {
  execFileSync("bash", ["-n", "scripts/deploy-cvm-quick.sh"]);
  assert.match(docs, /直接点击 `Run workflow`/);
  assert.match(docs, /任何一项不满足都会在切换前停止/);
  assert.match(docs, /自动回滚/);
  assert.match(docs, /\.rmb-quick-deploy-audit\.jsonl/);
});
