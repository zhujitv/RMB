import { spawnSync } from "node:child_process";

function runNpmScript(script) {
  const result = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const target = String(process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV || "").trim().toLowerCase();

if (target === "production") {
  console.log("Production release detected: applying pending Prisma migrations before the application build.");
  runNpmScript("db:deploy");
} else {
  console.log("Non-production build detected: database migrations are intentionally skipped.");
}

runNpmScript("build:app");
