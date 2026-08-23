#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILES = process.env.RMB_SKIP_LOCAL_ENV_FILES === "1"
  ? []
  : [".env", ".env.local"];
const originalEnvKeys = new Set(Object.keys(process.env));

function unquote(value) {
  if (!value) return "";
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) return value;
  const body = value.slice(1, -1);
  if (quote === "'") return body;
  return body
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll("\\\"", "\"")
    .replaceAll("\\\\", "\\");
}

function parseEnvLine(line) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) return null;
  let value = match[2].trim();
  if (!value.startsWith("\"") && !value.startsWith("'")) {
    value = value.replace(/\s+#.*$/, "").trim();
  }
  return [match[1], unquote(value)];
}

function loadEnvFile(fileName) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (originalEnvKeys.has(key)) continue;
    process.env[key] = value;
  }
}

for (const fileName of ENV_FILES) {
  loadEnvFile(fileName);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/run-with-env.mjs <command> [...args]");
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
