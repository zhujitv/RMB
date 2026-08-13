import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { secureDatabaseUrl } from "./database-url-security";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL 未配置，请在应用的受保护环境变量中配置 PostgreSQL 连接字符串。");
}
const secureConnectionString = secureDatabaseUrl(databaseUrl);
const configuredPoolMax = Number.parseInt(process.env.DATABASE_POOL_MAX || "", 10);
const databasePoolMax = Number.isInteger(configuredPoolMax) && configuredPoolMax >= 1 && configuredPoolMax <= 10
  ? configuredPoolMax
  : process.env.NODE_ENV === "production" ? 2 : 10;
const configuredConnectionTimeoutMs = Number.parseInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS || "", 10);
const databaseConnectionTimeoutMs = Number.isInteger(configuredConnectionTimeoutMs)
  && configuredConnectionTimeoutMs >= 5_000
  && configuredConnectionTimeoutMs <= 60_000
  ? configuredConnectionTimeoutMs
  : 30_000;
const databasePoolLifetimeOptions = process.env.NODE_ENV === "production"
  ? {
      idleTimeoutMillis: 5_000,
      maxLifetimeSeconds: 300,
      allowExitOnIdle: true,
    }
  : {
      idleTimeoutMillis: 60_000,
      maxLifetimeSeconds: 300,
      allowExitOnIdle: true,
    };

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: secureConnectionString,
      max: databasePoolMax,
      min: 0,
      connectionTimeoutMillis: databaseConnectionTimeoutMs,
      ...databasePoolLifetimeOptions,
      application_name: "nextwood-app",
    }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

globalForPrisma.prisma = prisma;
