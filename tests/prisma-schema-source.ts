import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function collectSchemaFiles(directory: string): string[] {
  return readdirSync(directory)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entry) => {
      if (entry === "migrations") return [];
      const filePath = path.join(directory, entry);
      if (statSync(filePath).isDirectory()) return collectSchemaFiles(filePath);
      return filePath.endsWith(".prisma") ? [filePath] : [];
    });
}

export function readPrismaSchemaSource() {
  const prismaDirectory = path.join(process.cwd(), "prisma");
  return collectSchemaFiles(prismaDirectory)
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
}
