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

test("CVM deployment avoids direct GitHub pulls from the server", () => {
  assert.match(workflow, /git bundle create/);
  assert.match(workflow, /scp/);
  assert.match(remoteScript, /git bundle verify/);
  assert.match(remoteScript, /git fetch "\$BUNDLE" deploy-target/);
  assert.doesNotMatch(remoteScript, /git pull|git fetch origin main/);
});

test("CVM deployment can recover when the server checkout has no readable HEAD", () => {
  assert.match(workflow, /git rev-parse --verify HEAD 2>\/dev\/null \|\| true/);
  assert.match(workflow, /creating a full deployment bundle/);
  assert.match(workflow, /git bundle create "\$bundle_path" deploy-target/);
  assert.match(remoteScript, /CURRENT_HEAD="\$\(git rev-parse --verify HEAD 2>\/dev\/null \|\| true\)"/);
  assert.match(remoteScript, /bootstrapping from the deployment bundle/);
  assert.match(remoteScript, /git checkout --force -B main FETCH_HEAD/);
});

test("CVM deployment repairs app checkout ownership before writing git state", () => {
  assert.match(remoteScript, /ensure_checkout_writable\(\)/);
  assert.match(remoteScript, /touch "\$app_probe" "\$git_probe"/);
  assert.match(remoteScript, /git status --short >\/dev\/null 2>&1/);
  assert.match(remoteScript, /chown -R "\$\(id -un\):\$\(id -gn\)" "\$APP_DIR"/);
  assert.match(remoteScript, /ensure_checkout_writable[\s\S]*CURRENT_HEAD/);
});

test("CVM deployment stays migration-safe and uses the app build only", () => {
  assert.match(workflow, /RMB_CVM_ENV_FILE/);
  assert.match(remoteScript, /source "\$ENV_FILE"/);
  assert.match(remoteScript, /npx prisma migrate status/);
  assert.match(remoteScript, /npm run build:app/);
  assert.match(remoteScript, /HEALTH_ATTEMPTS/);
  assert.match(workflow, /Public health not ready yet/);
  assert.doesNotMatch(remoteScript, /db:deploy|build:release|prisma migrate deploy|prisma db push|prisma migrate dev/);
});

test("CVM deployment isolates dependency scripts before loading protected environment", () => {
  assert.match(remoteScript, /export RMB_SKIP_LOCAL_ENV_FILES=1/);
  assert.match(remoteScript, /DATABASE_URL="postgresql:\/\/127\.0\.0\.1:5432\/rmb_prisma_generate"/);
  assert.match(remoteScript, /fail "build environment file not found: \$ENV_FILE"/);
  assert.match(remoteScript, /env_contents="\$\(\$SUDO_CMD -n cat -- "\$ENV_FILE"\)"/);
  assert.match(remoteScript, /source \/dev\/stdin <<< "\$env_contents"/);
  assert.match(remoteScript, /unset env_contents/);
  assert.doesNotMatch(remoteScript, /chmod[^\n]*ENV_FILE|chown[^\n]*ENV_FILE/);
  const skipIndex = remoteScript.indexOf("export RMB_SKIP_LOCAL_ENV_FILES=1");
  const installIndex = remoteScript.indexOf("npm ci --prefer-offline");
  const protectedEnvIndex = remoteScript.lastIndexOf("\nload_build_environment\n");
  assert.ok(skipIndex >= 0 && skipIndex < installIndex, "local env files must be skipped before npm lifecycle scripts");
  assert.ok(protectedEnvIndex > installIndex, "production secrets must load only after npm lifecycle scripts finish");
  assert.match(prismaConfig, /process\.env\.RMB_SKIP_LOCAL_ENV_FILES === "1"/);
  assert.match(runWithEnvScript, /process\.env\.RMB_SKIP_LOCAL_ENV_FILES === "1"/);
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
  assert.match(docs, /不再依赖 CVM 直接连接 GitHub/);
  assert.match(docs, /不自动执行数据库迁移/);
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
