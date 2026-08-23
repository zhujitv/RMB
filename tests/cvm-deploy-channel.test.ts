import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(".github/workflows/deploy-cvm.yml", "utf8");
const remoteScript = readFileSync("scripts/deploy-cvm-from-bundle.sh", "utf8");
const prismaConfig = readFileSync("prisma.config.ts", "utf8");
const runWithEnvScript = readFileSync("scripts/run-with-env.mjs", "utf8");
const backupInstallScript = readFileSync("scripts/install-cvm-db-backup-strategy.sh", "utf8");
const docs = readFileSync("docs/CVM_DEPLOYMENT_CHANNEL.md", "utf8");

test("CVM deployment channel is manual by default and can be explicitly automated after CI", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /vars\.RMB_CVM_AUTO_DEPLOY == 'true'/);
  assert.match(workflow, /concurrency:[\s\S]*rmb-cvm-production/);
});

test("CVM deployment channel uses SSH secrets with strict host verification", () => {
  assert.match(workflow, /RMB_CVM_HOST/);
  assert.match(workflow, /RMB_CVM_USER/);
  assert.match(workflow, /RMB_CVM_SSH_KEY/);
  assert.match(workflow, /RMB_CVM_KNOWN_HOSTS/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(workflow, /ssh-keyscan/);
});

test("CVM builds before creating SSH credentials and never interpolates dispatch inputs into shell", () => {
  const artifactStep = workflow.match(
    /- name: Build isolated deployment artifact[\s\S]*?(?=\n\s+- name: Check deployment secrets)/,
  )?.[0] || "";
  const buildIndex = workflow.indexOf("- name: Build isolated deployment artifact");
  const sshIndex = workflow.indexOf("- name: Prepare SSH");

  assert.ok(artifactStep, "isolated build step must exist");
  assert.ok(buildIndex >= 0 && sshIndex > buildIndex, "SSH credentials must be created only after the build");
  assert.doesNotMatch(artifactStep, /secrets\.|DEPLOY_SSH_KEY|rmb-cvm-deploy/);
  const shellBlocks = [...workflow.matchAll(/^\s+run: \|\n((?:^ {10,}.*\n?)*)/gm)].map((match) => match[1]);
  assert.ok(shellBlocks.length > 0, "workflow shell blocks must be discoverable");
  for (const shellBlock of shellBlocks) {
    assert.doesNotMatch(shellBlock, /\$\{\{\s*inputs\./);
  }
  assert.match(workflow, /INPUT_REF:\s*\$\{\{ inputs\.ref \}\}/);
  assert.match(workflow, /git check-ref-format --branch "\$deploy_ref"/);
  assert.match(workflow, /INPUT_SAFE_MIGRATION:\s*\$\{\{ inputs\.safe_prisma_migration \}\}/);
  assert.match(workflow, /build:[\s\S]*?name: Build deployment artifact/);
  assert.match(workflow, /deploy:[\s\S]*?needs: build[\s\S]*?environment: production/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /- name: Checkout exact deployment commit[\s\S]*?ref: \$\{\{ needs\.build\.outputs\.sha \}\}/);
});

test("CVM deployment avoids direct GitHub pulls from the server", () => {
  assert.match(workflow, /git bundle create/);
  assert.match(workflow, /scp/);
  assert.match(remoteScript, /git bundle verify/);
  assert.match(remoteScript, /git fetch "\$BUNDLE" deploy-target/);
  assert.doesNotMatch(remoteScript, /git pull|git fetch origin main/);
});

test("CVM full deployment shares the non-blocking production lock with quick deployment", () => {
  assert.match(remoteScript, /LOCK_FILE="\$APP_DIR\/\.rmb-production-deploy\.lock"/);
  assert.match(remoteScript, /command -v flock >\/dev\/null \|\| fail "flock is required"/);
  assert.match(remoteScript, /mkdir -p "\$\(dirname "\$LOCK_FILE"\)"/);
  assert.match(remoteScript, /exec 9>"\$LOCK_FILE"/);
  assert.match(remoteScript, /flock -n 9 \|\| fail "another production deployment is already running"/);
  assert.doesNotMatch(remoteScript, /RMB_DEPLOY_LOCK_FILE/);
  assert.doesNotMatch(workflow, /RMB_CVM_DEPLOY_LOCK_FILE|RMB_DEPLOY_LOCK_FILE/);

  const lockIndex = remoteScript.indexOf('flock -n 9 || fail "another production deployment is already running"');
  const fetchIndex = remoteScript.indexOf('git fetch "$BUNDLE" deploy-target');
  const extractIndex = remoteScript.indexOf('tar -xzf "$BUILD_ARCHIVE" -C "$CANDIDATE_DIR"');
  const sourceSwitchIndex = remoteScript.indexOf('git merge --ff-only FETCH_HEAD');
  const buildSwitchIndex = remoteScript.indexOf('mv "$APP_DIR/.next" "$ROLLBACK_DIR/.next"');

  assert.ok(lockIndex >= 0, "production deploy lock must be acquired");
  assert.ok(fetchIndex > lockIndex, "lock must be acquired before fetching the source bundle");
  assert.ok(extractIndex > lockIndex, "lock must be acquired before extracting the build archive");
  assert.ok(sourceSwitchIndex > lockIndex, "lock must be acquired before switching source");
  assert.ok(buildSwitchIndex > lockIndex, "lock must be acquired before switching the build");
});

test("CVM deployment uses the successful-release marker as its deployed baseline", () => {
  const bundleStep = workflow.match(
    /- name: Build incremental git bundle[\s\S]*?(?=\n\s+- name: Upload and run deployment)/,
  )?.[0] || "";

  assert.ok(bundleStep, "bundle workflow step must exist");
  assert.match(bundleStep, /if \[\[ -f \.rmb-deployed-sha \]\]/);
  assert.match(bundleStep, /deployed_sha="\$\(tr -d '\\r\\n' < \.rmb-deployed-sha\)"/);
  assert.match(bundleStep, /base_deployed_sha="\$deployed_sha"/);
  assert.match(bundleStep, /No successful deployment baseline is available and the server marker is missing/);
  assert.match(bundleStep, /printf 'base_sha=%s\\n' "\$base_deployed_sha"/);
  assert.match(bundleStep, /if \[\[ "\$deployed_sha" == "\$deploy_sha" && "\$build_sha" == "\$deploy_sha" \]\]/);
  assert.match(bundleStep, /printf 'up_to_date=true\\n'/);
  assert.match(remoteScript, /DEPLOYED_SHA_FILE="\$APP_DIR\/\.rmb-deployed-sha"/);

  assert.match(workflow, /- name: Upload and run deployment[\s\S]*?if: steps\.bundle\.outputs\.up_to_date != 'true'/);
});

test("CVM deployment refuses unwritable checkouts without recursive ownership changes", () => {
  assert.match(remoteScript, /ensure_checkout_writable\(\)/);
  assert.match(remoteScript, /touch "\$app_probe" "\$git_probe"/);
  assert.match(remoteScript, /refusing to change ownership recursively/);
  assert.doesNotMatch(remoteScript, /\bchown\b[^\n]*(?:-R|--recursive)/);
  assert.match(remoteScript, /ensure_checkout_writable[\s\S]*CURRENT_HEAD/);
});

test("GitHub Runner creates the default .next artifact with non-sensitive build values", () => {
  const artifactStep = workflow.match(
    /- name: Build isolated deployment artifact[\s\S]*?(?=\n\s+- name: Check deployment secrets)/,
  )?.[0] || "";
  const uploadStep = workflow.match(
    /- name: Upload and run deployment[\s\S]*?(?=\n\s+- name: Public health check)/,
  )?.[0] || "";
  const migrationStep = workflow.match(
    /- name: Apply single safe Prisma migration[\s\S]*?(?=\n\s+- name:)/,
  )?.[0] || "";

  assert.ok(artifactStep, "Runner artifact build step must exist");
  assert.ok(uploadStep, "ordinary deployment workflow step must exist");
  assert.ok(migrationStep, "protected migration workflow step must exist");
  assert.match(artifactStep, /export RMB_SKIP_LOCAL_ENV_FILES=1/);
  assert.match(artifactStep, /DATABASE_URL="postgresql:\/\/127\.0\.0\.1:5432\/rmb_prisma_generate"[\s\\]*npm ci --prefer-offline/);
  assert.match(artifactStep, /DATABASE_URL="postgresql:\/\/127\.0\.0\.1:5432\/rmb_build_only"/);
  assert.match(artifactStep, /APP_URL="\$public_origin"/);
  assert.match(artifactStep, /NEXT_PUBLIC_APP_URL="\$public_origin"/);
  assert.match(artifactStep, /SECURITY_BUILD_MODE=preview/);
  assert.match(artifactStep, /npm run build:app/);
  assert.match(artifactStep, /printf '%s\\n' "\$deploy_sha" > \.next\/RMB_DEPLOY_SHA/);
  assert.match(artifactStep, /tar --exclude='\.next\/cache' -czf "\$artifact_path" \.next/);
  assert.match(uploadStep, /BUILD_ARCHIVE_PATH: \$\{\{ runner\.temp \}\}\/rmb-deployment-artifact\/rmb-next-\$\{\{ needs\.build\.outputs\.sha \}\}\.tar\.gz/);
  assert.match(uploadStep, /RMB_BUILD_ARCHIVE=%q/);
  assert.doesNotMatch(uploadStep, /RMB_ENV_FILE/);
  assert.match(migrationStep, /RMB_ENV_FILE/);
  assert.match(migrationStep, /if \[\[ -r "\$ENV_FILE" \]\]/);
  assert.match(migrationStep, /systemctl show "\$SERVICE" --property=MainPID --value/);
  assert.match(migrationStep, /fs\.readFileSync\(`\/proc\/\$\{pid\}\/environ`\)/);
  assert.match(migrationStep, /entry\.slice\("DATABASE_URL="\.length\)/);
  assert.match(migrationStep, /sudo -n test -r "\$ENV_FILE"/);
  assert.match(migrationStep, /DATABASE_URL="\$\(sudo -n env RMB_ENV_FILE="\$ENV_FILE"/);
  assert.match(migrationStep, /printf "%s" "\$DATABASE_URL"/);
  assert.doesNotMatch(workflow, /RMB_NEXT_DIST_DIR/);
});

test("CVM only verifies and switches the uploaded artifact; it never installs or builds", () => {
  assert.doesNotMatch(remoteScript, /\bnpm\s+(?:ci|install|run)\b|\bnpx\b|\bnext\s+build\b/);
  assert.doesNotMatch(remoteScript, /RMB_NEXT_DIST_DIR/);
  assert.doesNotMatch(remoteScript, /\bDATABASE_URL\b|RMB_ENV_FILE|source\s+[^\n]*app\.env|cat\s+[^\n]*app\.env/);
  assert.match(remoteScript, /BUILD_ARCHIVE="\$\{RMB_BUILD_ARCHIVE:-\}"/);
  assert.match(remoteScript, /while IFS= read -r archive_entry/);
  assert.match(remoteScript, /\.next\|\.next\/\*\)/);
  assert.match(remoteScript, /build archive contains path traversal/);
  assert.match(remoteScript, /tar -xzf "\$BUILD_ARCHIVE" -C "\$CANDIDATE_DIR"/);
  assert.match(remoteScript, /"\$CANDIDATE_DIR\/\.next\/BUILD_ID"/);
  assert.match(remoteScript, /"\$CANDIDATE_DIR\/\.next\/RMB_DEPLOY_SHA"/);
  assert.match(remoteScript, /build archive SHA marker does not match the requested deployment/);
  assert.match(prismaConfig, /process\.env\.RMB_SKIP_LOCAL_ENV_FILES === "1"/);
  assert.match(runWithEnvScript, /process\.env\.RMB_SKIP_LOCAL_ENV_FILES === "1"/);
});

test("CVM deployment blocks dependency and unapproved Prisma changes from the deployed baseline", () => {
  const schemaDiff = remoteScript.match(/SCHEMA_CHANGES="\$\((git diff --name-only[^\n]+)\)"/)?.[1] || "";

  assert.match(remoteScript, /function normalizedPackage\(ref\)/);
  assert.match(remoteScript, /function normalizedLock\(ref\)/);
  assert.match(remoteScript, /delete value\.version/);
  assert.match(remoteScript, /delete value\.packages\[""\]\.version/);
  assert.match(remoteScript, /isDeepStrictEqual/);
  assert.match(remoteScript, /check_dependency_contract "\$BASE_DEPLOYED_SHA" "\$TARGET_SHA"/);
  assert.match(remoteScript, /runtime dependencies changed; use a full release deployment/);

  assert.ok(schemaDiff, "Prisma change diff must exist");
  assert.match(schemaDiff, /"\$BASE_DEPLOYED_SHA" "\$TARGET_SHA"/);
  assert.match(schemaDiff, /prisma\/migrations/);
  assert.match(schemaDiff, /prisma\/models/);
  assert.match(remoteScript, /Prisma schema or migrations changed; run the protected migration workflow/);
  assert.match(remoteScript, /\[\[ "\$APPLIED_MIGRATION" =~ \^\[0-9\]\{14\}_\[a-z0-9_\]\+\$ \]\]/);
  assert.match(remoteScript, /"\$changed_file" == "prisma\/schema\.prisma"/);
  assert.match(remoteScript, /"\$changed_file" == "prisma\/models\/"\*/);
  assert.match(remoteScript, /"\$changed_file" == "prisma\/migrations\/\$APPLIED_MIGRATION\/"\*/);
  assert.match(remoteScript, /unapproved Prisma change detected/);
});

test("CVM validates systemd runtime wiring before changing source or .next", () => {
  assert.match(remoteScript, /"\$SYSTEMCTL_BIN" show "\$SERVICE" --property=EnvironmentFiles --value/);
  assert.match(remoteScript, /grep -Fqx -- "\$EXPECTED_ENV_FILE"/);
  assert.match(remoteScript, /systemd service does not reference the exact expected protected environment file/);
  assert.match(remoteScript, /"\$SYSTEMCTL_BIN" show "\$SERVICE" --property=WorkingDirectory --value/);
  assert.match(remoteScript, /"\$SERVICE_WORKING_DIR" == "\$APP_DIR"/);
  assert.match(remoteScript, /systemd service WorkingDirectory does not match/);

  const environmentPreflightIndex = remoteScript.indexOf('SERVICE_ENV_FILES="$("$SYSTEMCTL_BIN" show');
  const workingDirectoryPreflightIndex = remoteScript.indexOf('SERVICE_WORKING_DIR="$("$SYSTEMCTL_BIN" show');
  const sourceSwitchIndex = remoteScript.indexOf('git merge --ff-only FETCH_HEAD');
  const buildSwitchIndex = remoteScript.indexOf('mv "$APP_DIR/.next" "$ROLLBACK_DIR/.next"');
  assert.ok(environmentPreflightIndex >= 0, "systemd EnvironmentFiles preflight must exist");
  assert.ok(workingDirectoryPreflightIndex > environmentPreflightIndex, "WorkingDirectory must be checked after EnvironmentFiles");
  assert.ok(sourceSwitchIndex > workingDirectoryPreflightIndex, "systemd must be checked before the source switch");
  assert.ok(buildSwitchIndex > workingDirectoryPreflightIndex, "systemd must be checked before the build switch");
});

test("CVM restores source and .next when activation or readiness fails", () => {
  const publicHealthStep = workflow.match(
    /- name: Public health check[\s\S]*?(?=\n\s+- name: Already up to date)/,
  )?.[0] || "";

  assert.match(remoteScript, /READY_URL="\$\{RMB_READY_URL:-http:\/\/127\.0\.0\.1:3000\/api\/health\}"/);
  assert.match(remoteScript, /PUBLIC_READY_URL="\$\{RMB_PUBLIC_READY_URL:-https:\/\/www\.nextwood\.net\/api\/health\}"/);
  assert.match(remoteScript, /HEALTH_ATTEMPTS/);
  assert.match(remoteScript, /curl --fail --silent --show-error --max-time 15 "\$url"/);
  assert.match(remoteScript, /rollback_deployment\(\)/);
  assert.match(remoteScript, /SWITCH_ACTIVE=1/);
  assert.match(remoteScript, /trap 'exit 129' HUP/);
  assert.match(remoteScript, /trap 'exit 130' INT/);
  assert.match(remoteScript, /trap 'exit 143' TERM/);
  assert.match(remoteScript, /deployment stopped during activation; attempting automatic rollback/);
  assert.match(remoteScript, /mv "\$APP_DIR\/\.next" "\$CANDIDATE_DIR\/\.next-failed"/);
  assert.match(remoteScript, /mv "\$ROLLBACK_DIR\/\.next" "\$APP_DIR\/\.next"/);
  assert.match(remoteScript, /restore_source \|\| return 1/);
  assert.match(remoteScript, /git restore --source="\$BASE_DEPLOYED_SHA" --staged --worktree -- \./);
  assert.match(remoteScript, /check_health "\$ROLLBACK_HEALTH_URL" "rollback"/);
  assert.match(remoteScript, /fail_after_switch "service restart failed"/);
  assert.match(remoteScript, /fail_after_switch "service is not active after restart"/);
  assert.match(remoteScript, /check_health "\$READY_URL" "local readiness" "\$TARGET_SHA"[\s\\]*\|\| fail_after_switch "local readiness check failed"/);
  assert.match(remoteScript, /check_health "\$PUBLIC_READY_URL" "public readiness" "\$TARGET_SHA"[\s\\]*\|\| fail_after_switch "public readiness check failed"/);

  const localReadyIndex = remoteScript.indexOf('check_health "$READY_URL" "local readiness"');
  const publicReadyIndex = remoteScript.indexOf('check_health "$PUBLIC_READY_URL" "public readiness"');
  const markerWriteIndex = remoteScript.indexOf('mv "$marker_tmp" "$DEPLOYED_SHA_FILE"');
  const rollbackRemovalIndex = remoteScript.indexOf('rm -rf -- "$ROLLBACK_DIR"');
  assert.ok(localReadyIndex >= 0, "local readiness check must exist");
  assert.ok(publicReadyIndex > localReadyIndex, "public readiness must follow local readiness");
  assert.ok(markerWriteIndex > publicReadyIndex, "deployed marker must be written only after readiness passes");
  assert.ok(rollbackRemovalIndex > markerWriteIndex, "old build must remain available until the marker is committed");

  assert.ok(publicHealthStep, "public health workflow step must exist");
  assert.match(publicHealthStep, /public_url="\$\{public_url%\/\}\/api\/health"/);
  assert.match(publicHealthStep, /curl --fail --silent --show-error --max-time 20 "\$public_url"/);
  assert.doesNotMatch(publicHealthStep, /curl[^\n]*--head/);
  assert.match(publicHealthStep, /Public health not ready yet/);
  assert.match(publicHealthStep, /Public health check passed/);
});

test("run-with-env skips inaccessible local files only when the deploy flag is set", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "rmb-run-with-env-"));
  const scriptPath = resolve("scripts/run-with-env.mjs");
  try {
    mkdirSync(join(fixtureDir, ".env.local"));
    const skippedOutput = execFileSync(
      process.execPath,
      [scriptPath, process.execPath, "-e", "process.stdout.write(process.env.RMB_PARENT_ENV || '')"],
      {
        cwd: fixtureDir,
        encoding: "utf8",
        env: { ...process.env, RMB_SKIP_LOCAL_ENV_FILES: "1", RMB_PARENT_ENV: "inherited" },
      },
    );
    assert.equal(skippedOutput, "inherited");

    rmSync(join(fixtureDir, ".env.local"), { recursive: true });
    writeFileSync(join(fixtureDir, ".env.local"), "RMB_FILE_ENV=loaded\n", "utf8");
    const localEnv = { ...process.env };
    delete localEnv.RMB_SKIP_LOCAL_ENV_FILES;
    const loadedOutput = execFileSync(
      process.execPath,
      [scriptPath, process.execPath, "-e", "process.stdout.write(process.env.RMB_FILE_ENV || '')"],
      { cwd: fixtureDir, encoding: "utf8", env: localEnv },
    );
    assert.equal(loadedOutput, "loaded");
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test("CVM deployment docs explain setup and rollback boundaries", () => {
  assert.ok(existsSync("docs/CVM_DEPLOYMENT_CHANNEL.md"));
  assert.match(docs, /无生产权限的 Build job 在干净检出中使用非敏感构建参数生成默认 `\.next` 归档/);
  assert.match(docs, /普通部署不会读取生产数据库，也不会执行或检查迁移状态/);
  assert.match(docs, /本机或公网 `\/api\/health` 未通过时恢复旧源码与旧构建/);
  assert.match(docs, /全部就绪检查成功后，CVM 才写入 `\.rmb-deployed-sha`/);
  assert.match(docs, /RMB_CVM_AUTO_DEPLOY=true/);
});

test("CVM database backups use the shared server strategy without private fallback", () => {
  assert.ok(existsSync("scripts/install-cvm-db-backup-strategy.sh"));
  assert.match(workflow, /RMB_CVM_DB_BACKUP_DIR/);
  assert.match(workflow, /shared backup directory is not writable/);
  assert.doesNotMatch(workflow, /HOME\/rmb-db-backups|private fallback/);
  assert.match(backupInstallScript, /rmb-db-backup\.timer/);
  assert.match(backupInstallScript, /RMB_DB_BACKUP_RETENTION_DAYS:-15/);
  assert.match(backupInstallScript, /\/srv\/rmb\/shared\/db-backups/);
  assert.match(backupInstallScript, /\/usr\/pgsql-18\/bin\/pg_dump/);
  assert.match(backupInstallScript, /PGPASSWORD/);
  assert.match(docs, /数据库备份策略/);
  assert.match(docs, /超过 15 天/);
});
