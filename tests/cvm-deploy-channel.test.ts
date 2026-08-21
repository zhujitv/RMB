import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/deploy-cvm.yml", "utf8");
const remoteScript = readFileSync("scripts/deploy-cvm-from-bundle.sh", "utf8");
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
