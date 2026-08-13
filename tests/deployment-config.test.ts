import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

type CronEntry = { path?: unknown; schedule?: unknown };

const config = JSON.parse(readFileSync("config/tencent-cloud-cron.json", "utf8")) as {
  crons?: CronEntry[];
};

test("every configured cron points to a real authenticated route", () => {
  const crons = config.crons || [];
  assert.ok(crons.length > 0, "at least one production cron must remain configured");

  for (const cron of crons) {
    assert.equal(typeof cron.path, "string");
    assert.equal(typeof cron.schedule, "string");
    const routeFile = `app${cron.path}/route.ts`;
    assert.ok(existsSync(routeFile), `configured cron route is missing: ${routeFile}`);
    const source = readFileSync(routeFile, "utf8");
    assert.match(source, /assertCronSecret\(request\)/, `${cron.path} must verify CRON_SECRET`);
  }
});

test("removed supplier OCR polling is not scheduled", () => {
  assert.equal(
    (config.crons || []).some((cron) => cron.path === "/api/cron/supplier-document-ocr"),
    false,
  );
});

test("release version is consistent between package manifests", () => {
  const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as { version?: unknown };
  const lockManifest = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    version?: unknown;
    packages?: Record<string, { version?: unknown }>;
  };
  assert.match(String(packageManifest.version || ""), /^\d+\.\d+\.\d+$/);
  assert.equal(lockManifest.version, packageManifest.version);
  assert.equal(lockManifest.packages?.[""]?.version, packageManifest.version);
});

test("ordinary Git and Tencent Cloud builds never deploy database migrations", () => {
  const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, unknown>;
  };

  assert.equal(packageManifest.scripts?.build, "npm run build:app");
  assert.doesNotMatch(String(packageManifest.scripts?.build), /db:deploy|prisma\s+migrate\s+deploy/);
});

test("repository has no Vercel deployment entrypoints", () => {
  assert.equal(existsSync(".github/workflows/vercel-deploy.yml"), false);
  assert.equal(existsSync("vercel.json"), false);
  assert.equal(existsSync("scripts/vercel-release-build.mjs"), false);
});

test("database migration remains an explicit protected release action", () => {
  const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, unknown>;
  };

  assert.equal(
    packageManifest.scripts?.["build:release"],
    "node scripts/run-with-env.mjs prisma migrate deploy && npm run build:app",
  );
  assert.equal(
    packageManifest.scripts?.["db:deploy"],
    "node scripts/run-with-env.mjs prisma migrate deploy",
  );
});
