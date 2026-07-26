#!/usr/bin/env node
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const missing = Object.entries(lock.packages || {})
  .filter(([path, metadata]) => path.startsWith("node_modules/")
    && !metadata?.link
    && (!metadata?.resolved || !metadata?.integrity))
  .map(([path]) => path);

if (missing.length) {
  console.error("Lockfile packages missing resolved/integrity metadata:");
  missing.forEach((path) => console.error(`- ${path}`));
  process.exitCode = 1;
} else {
  console.log(`Lockfile integrity passed: ${Object.keys(lock.packages || {}).length - 1} packages checked.`);
}
