import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, env } from "prisma/config";

const originalEnvKeys = new Set(Object.keys(process.env));

function unquoteEnvValue(value: string) {
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

function loadEnvFile(fileName: string) {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (originalEnvKeys.has(key)) continue;
    let value = match[2].trim();
    if (!value.startsWith("\"") && !value.startsWith("'")) {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[key] = unquoteEnvValue(value);
  }
}

[".env", ".env.local"].forEach(loadEnvFile);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
