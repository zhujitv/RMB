import fs from "node:fs";
import path from "node:path";

const SOURCE_ROOTS = ["app", "lib"];
const IGNORE_DIRS = new Set([".next", "node_modules", "generated", "coverage", "dist"]);
const MAX_ROUTE_RESULTS = 10;
const SERVICE_API_HINTS = [
  { pattern: /cost-records/i, routes: ["/api/costs", "/api/reports?type=costs"] },
  { pattern: /logistics-expense/i, routes: ["/api/logistics-expenses", "/api/logistics-costs"] },
  { pattern: /tax-refunds/i, routes: ["/api/tax-refund", "/api/tax-refunds"] },
  { pattern: /orders-module/i, routes: ["/api/orders", "/api/reports?type=receivables"] },
  { pattern: /payments-module/i, routes: ["/api/payments", "/api/receipts"] },
  { pattern: /profit-overview/i, routes: ["/api/profit", "/api/overview"] },
  { pattern: /domestic-logistics/i, routes: ["/api/domestic-logistics"] },
  { pattern: /order-documents/i, routes: ["/api/order-documents"] },
  { pattern: /workbench-todos/i, routes: ["/api/workbench/todos"] },
  { pattern: /audit-logs/i, routes: ["/api/audit-logs"] },
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function extractCall(source, index) {
  const start = source.indexOf("(", index);
  if (start < 0) return "";
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(index, cursor + 1);
    }
  }
  return source.slice(index, index + 1000);
}

function routePathFromFile(file) {
  if (!file.startsWith(`app${path.sep}api${path.sep}`)) return "";
  const withoutPrefix = file.replace(new RegExp(`^app\\${path.sep}api\\${path.sep}`), "");
  const withoutRoute = withoutPrefix.replace(new RegExp(`\\${path.sep}route\\.(ts|js)$`), "");
  return `/api/${withoutRoute.split(path.sep).join("/")}`;
}

const files = SOURCE_ROOTS.flatMap((root) => walk(root));
const findManyCalls = [];
const routeScores = new Map();
const serviceScores = new Map();

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const routePath = routePathFromFile(file);
  const serviceHint = SERVICE_API_HINTS.find((item) => item.pattern.test(file));
  const serviceScore = serviceHint
    ? serviceScores.get(file) || {
        routePath: serviceHint.routes.join(", "),
        file,
        findMany: 0,
        findManyWithoutTake: 0,
        count: 0,
        include: 0,
        relationInclude: 0,
        score: 0,
      }
    : null;
  const routeScore = routePath
    ? routeScores.get(routePath) || {
        routePath,
        file,
        findMany: 0,
        findManyWithoutTake: 0,
        count: 0,
        include: 0,
        relationInclude: 0,
        score: 0,
      }
    : null;

  const findManyPattern = /\b(?:prisma|tx)\.([A-Za-z0-9_]+)\.findMany\s*\(/g;
  let match;
  while ((match = findManyPattern.exec(source))) {
    const call = extractCall(source, match.index);
    const hasTake = /\btake\s*:|\btake\s*(?:,|\})/.test(call);
    const hasInclude = /\binclude\s*:/.test(call);
    const relationInclude = (call.match(/\binclude\s*:/g) || []).length;
    const row = {
      file,
      line: lineOf(source, match.index),
      model: match[1],
      hasTake,
      hasInclude,
      relationInclude,
      preview: call.replace(/\s+/g, " ").slice(0, 180),
    };
    findManyCalls.push(row);
    if (routeScore) {
      routeScore.findMany += 1;
      if (!hasTake) routeScore.findManyWithoutTake += 1;
      if (hasInclude) routeScore.include += 1;
      routeScore.relationInclude += relationInclude;
      routeScore.score += 4 + (hasTake ? 0 : 8) + relationInclude * 2;
    }
    if (serviceScore) {
      serviceScore.findMany += 1;
      if (!hasTake) serviceScore.findManyWithoutTake += 1;
      if (hasInclude) serviceScore.include += 1;
      serviceScore.relationInclude += relationInclude;
      serviceScore.score += 4 + (hasTake ? 0 : 8) + relationInclude * 2;
    }
  }

  if (routeScore) {
    routeScore.count += (source.match(/\.(count|groupBy|aggregate)\s*\(/g) || []).length;
    routeScore.score += routeScore.count * 2;
    routeScores.set(routePath, routeScore);
  }
  if (serviceScore) {
    serviceScore.count += (source.match(/\.(count|groupBy|aggregate)\s*\(/g) || []).length;
    serviceScore.score += serviceScore.count * 2;
    serviceScores.set(file, serviceScore);
  }
}

const unboundedFindMany = findManyCalls
  .filter((item) => !item.hasTake)
  .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const slowApiSuspects = [...routeScores.values(), ...serviceScores.values()]
  .filter((item) => item.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, MAX_ROUTE_RESULTS);

console.log("NEXTWOOD Performance Audit");
console.log("==========================");
console.log(`findMany total: ${findManyCalls.length}`);
console.log(`findMany without take: ${unboundedFindMany.length}`);
console.log("");
console.log("Top 10 suspected slow API routes (static score):");
slowApiSuspects.forEach((item, index) => {
  console.log(`${index + 1}. ${item.routePath} score=${item.score} findMany=${item.findMany} noTake=${item.findManyWithoutTake} include=${item.include} count=${item.count}`);
  console.log(`   ${item.file}`);
});
console.log("");
console.log("findMany calls without take:");
unboundedFindMany.forEach((item) => {
  console.log(`- ${item.file}:${item.line} ${item.model} include=${item.hasInclude ? "yes" : "no"}`);
  console.log(`  ${item.preview}`);
});
