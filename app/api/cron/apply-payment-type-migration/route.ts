import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { Client } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const migrationName = "20260703183000_payment_type_options";
const migrationSql = `ALTER TABLE "payments"
  ALTER COLUMN "payment_type" SET DEFAULT '';`;
const checksum = crypto.createHash("sha256").update(`${migrationSql}\n`).digest("hex");

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function assertCronSecret(request: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "");
  if (!secret || secret === "change-me") throw new Error("CRON_SECRET 未配置");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    const error = new Error("定时任务密钥不正确") as Error & { status?: number };
    error.status = 401;
    throw error;
  }
}

function assertProductionDatabaseUrl(raw: string) {
  if (!raw) throw new Error("DATABASE_URL 未配置");
  const url = new URL(raw);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("拒绝对本地数据库执行生产迁移");
  }
  return { host: url.hostname, database: url.pathname.replace(/^\//, "") };
}

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function paymentTypeDefault(client: Client) {
  const result = await client.query<{ column_default: string | null }>(`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payments'
      AND column_name = 'payment_type'
    LIMIT 1;
  `);
  return result.rows[0]?.column_default || null;
}

function isBlankStringDefault(value: string | null) {
  return value === "''::text" || value === "''::character varying" || value === "''";
}

export async function POST(request: NextRequest) {
  let client: Client | null = null;
  try {
    assertCronSecret(request);
    const target = assertProductionDatabaseUrl(String(process.env.DATABASE_URL || ""));
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");
    await ensureMigrationsTable(client);
    const existing = await client.query<{ id: string; finished_at: Date | null }>(
      `SELECT id, finished_at
       FROM "_prisma_migrations"
       WHERE migration_name = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [migrationName],
    );
    const beforeDefault = await paymentTypeDefault(client);
    const latestMigration = existing.rows[0] || null;
    if (!latestMigration?.finished_at || !isBlankStringDefault(beforeDefault)) {
      await client.query(migrationSql);
      if (latestMigration && !latestMigration.finished_at) {
        await client.query(
          `UPDATE "_prisma_migrations"
           SET checksum = $1, finished_at = now(), logs = NULL, applied_steps_count = 1
           WHERE id = $2`,
          [checksum, latestMigration.id],
        );
      } else if (!latestMigration) {
        await client.query(
          `INSERT INTO "_prisma_migrations"
            (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
          [crypto.randomUUID(), checksum, migrationName],
        );
      }
    }
    const afterDefault = await paymentTypeDefault(client);
    await client.query("COMMIT");
    return json({
      ok: true,
      migrationName,
      alreadyApplied: Boolean(latestMigration?.finished_at),
      beforeDefault,
      afterDefault,
      target,
    });
  } catch (error: unknown) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    const typed = error as Error & { status?: number };
    return json({ ok: false, error: typed.message || "迁移执行失败" }, typed.status || 500);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
