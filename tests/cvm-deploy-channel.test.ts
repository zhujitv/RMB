import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/deploy-cvm.yml", "utf8");
const remoteScript = readFileSync("scripts/deploy-cvm-from-bundle.sh", "utf8");
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

test("CVM deployment stays migration-safe and uses the app build only", () => {
  assert.match(workflow, /RMB_CVM_ENV_FILE/);
  assert.match(remoteScript, /source "\$ENV_FILE"/);
  assert.match(remoteScript, /npx prisma migrate status/);
  assert.match(remoteScript, /npm run build:app/);
  assert.doesNotMatch(remoteScript, /db:deploy|build:release|prisma migrate deploy|prisma db push|prisma migrate dev/);
});

test("CVM deployment docs explain setup and rollback boundaries", () => {
  assert.ok(existsSync("docs/CVM_DEPLOYMENT_CHANNEL.md"));
  assert.match(docs, /不再依赖 CVM 直接连接 GitHub/);
  assert.match(docs, /不自动执行数据库迁移/);
  assert.match(docs, /RMB_CVM_AUTO_DEPLOY=true/);
});
