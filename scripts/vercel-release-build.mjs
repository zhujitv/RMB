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

console.log(
  "Application build detected: database migrations are intentionally skipped and must run separately from a protected release step.",
);
runNpmScript("build:app");
