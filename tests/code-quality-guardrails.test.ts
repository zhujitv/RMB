import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const SOURCE_ROOTS = ["app", "lib", "prisma", "tests", "scripts"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".prisma"]);
const BUSINESS_SOURCE_ROOTS = ["app", "lib", "prisma", "scripts"];
const BUSINESS_SOURCE_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, ".css", ".scss"]);
const MAX_BUSINESS_FILE_LINES = 300;
const EXCLUDED_SEGMENTS = new Set(["node_modules", ".next", "lib/generated", "output", "tmp"]);
const SELF = path.join("tests", "code-quality-guardrails.test.ts");

function shouldSkipPath(filePath: string) {
  return [...EXCLUDED_SEGMENTS].some((segment) => filePath.includes(`${path.sep}${segment}${path.sep}`));
}

function walkFiles(dir: string, extensions = SOURCE_EXTENSIONS): string[] {
  if (shouldSkipPath(dir)) return [];
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    if (shouldSkipPath(fullPath)) return [];
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walkFiles(fullPath, extensions);
    return extensions.has(path.extname(fullPath)) ? [fullPath] : [];
  });
}

function sourceFiles() {
  return SOURCE_ROOTS
    .flatMap((root) => walkFiles(path.join(process.cwd(), root)))
    .filter((filePath) => path.relative(process.cwd(), filePath) !== SELF);
}

function businessSourceFiles() {
  const cwd = process.cwd();
  const rootSourceFiles = readdirSync(cwd)
    .map((file) => path.join(cwd, file))
    .filter((filePath) => statSync(filePath).isFile())
    .filter((filePath) => BUSINESS_SOURCE_EXTENSIONS.has(path.extname(filePath)));
  return [
    ...BUSINESS_SOURCE_ROOTS.flatMap((root) => walkFiles(path.join(cwd, root), BUSINESS_SOURCE_EXTENSIONS)),
    ...rootSourceFiles,
  ].filter((filePath) => {
    const relativePath = path.relative(cwd, filePath);
    return !relativePath.startsWith(`tests${path.sep}`)
      && !relativePath.startsWith(`prisma${path.sep}migrations${path.sep}`)
      && !relativePath.startsWith(`lib${path.sep}generated${path.sep}`);
  });
}

function physicalLineCount(source: string) {
  if (!source) return 0;
  return source.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

function assertNoPattern(pattern: RegExp, message: string) {
  const offenders = sourceFiles()
    .map((filePath) => ({
      filePath,
      relativePath: path.relative(process.cwd(), filePath),
      source: readFileSync(filePath, "utf8"),
    }))
    .filter(({ source }) => pattern.test(source))
    .map(({ relativePath }) => relativePath);

  assert.deepEqual(offenders, [], message);
}

test("source files do not bypass TypeScript safety checks", () => {
  assertNoPattern(/@ts-nocheck|\/\/\s*@ts-ignore|\/\*\s*@ts-ignore\s*\*\//, "TypeScript bypass directives must not be introduced");
});

test("Prisma client usage does not erase generated model types", () => {
  assertNoPattern(/\b(?:const|let|var)\s+\w+\s*:\s*any\s*=\s*prisma\b/, "Prisma client must not be assigned to an any-typed alias");
});

test("business UI code does not force full-page refreshes after mutations", () => {
  assertNoPattern(/\bwindow\.location\.reload\s*\(|\blocation\.reload\s*\(|\brouter\.refresh\s*\(/, "Mutations must use local state updates or targeted refetches instead of full-page refreshes");
});

test("server code avoids unsafe raw SQL entry points", () => {
  assertNoPattern(/\$queryRawUnsafe|\$executeRawUnsafe/, "Unsafe Prisma raw SQL helpers must not be used");
});

test("business source files stay within the 300-line hard limit", () => {
  const offenders = businessSourceFiles()
    .map((filePath) => ({
      file: path.relative(process.cwd(), filePath),
      lines: physicalLineCount(readFileSync(filePath, "utf8")),
    }))
    .filter(({ lines }) => lines > MAX_BUSINESS_FILE_LINES)
    .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));

  assert.deepEqual(
    offenders,
    [],
    "Business files must not exceed 300 physical lines; keep new modules near the 280-line target",
  );
});

test("CI verification script keeps the full quality gate", () => {
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const verifyCi = String(packageJson.scripts?.["verify:ci"] || "");
  for (const required of ["npm run lint", "npm run typecheck", "npm test", "npm run build:app", "npm run audit"]) {
    assert.match(verifyCi, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `verify:ci must include ${required}`);
  }
});
