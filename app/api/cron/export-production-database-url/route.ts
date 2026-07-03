import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function assertToken(request: NextRequest) {
  const expected = String(process.env.DATABASE_URL_EXPORT_TOKEN || "");
  if (!expected) throw new Error("DATABASE_URL_EXPORT_TOKEN 未配置");
  if (request.headers.get("x-export-token") !== expected) {
    const error = new Error("导出令牌不正确") as Error & { status?: number };
    error.status = 401;
    throw error;
  }
}

function assertDatabaseUrl(raw: string) {
  if (!raw) throw new Error("DATABASE_URL 未配置");
  const url = new URL(raw);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("拒绝导出本地数据库连接");
  }
  return {
    host: url.hostname,
    database: url.pathname.replace(/^\//, ""),
  };
}

export async function POST(request: NextRequest) {
  try {
    assertToken(request);
    const databaseUrl = String(process.env.DATABASE_URL || "");
    const target = assertDatabaseUrl(databaseUrl);
    return json({ ok: true, databaseUrl, target });
  } catch (error: unknown) {
    const typed = error as Error & { status?: number };
    return json({ ok: false, error: typed.message || "DATABASE_URL 导出失败" }, typed.status || 500);
  }
}
