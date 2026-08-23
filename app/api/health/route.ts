import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
};

type ReadinessResult =
  | { status: "ok"; version: string; httpStatus: 200 }
  | { status: "unavailable"; httpStatus: 503 };

const successCacheMs = 10_000;
const failureCacheMs = 1_000;
let cachedReadiness: { expiresAt: number; value: ReadinessResult } | null = null;
let pendingReadiness: Promise<ReadinessResult> | null = null;

async function inspectReadiness(): Promise<ReadinessResult> {
  try {
    const version = (
      await readFile(join(process.cwd(), ".next", "RMB_DEPLOY_SHA"), "utf8")
    ).trim();
    if (!/^[a-f0-9]{40}$/.test(version)) {
      return { status: "unavailable", httpStatus: 503 };
    }
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", version, httpStatus: 200 };
  } catch {
    return { status: "unavailable", httpStatus: 503 };
  }
}

async function getReadiness() {
  const now = Date.now();
  if (cachedReadiness && cachedReadiness.expiresAt > now) {
    return cachedReadiness.value;
  }
  if (!pendingReadiness) {
    pendingReadiness = inspectReadiness().then((value) => {
      cachedReadiness = {
        value,
        expiresAt:
          Date.now() + (value.status === "ok" ? successCacheMs : failureCacheMs),
      };
      return value;
    });
  }
  try {
    return await pendingReadiness;
  } finally {
    pendingReadiness = null;
  }
}

export async function GET() {
  const readiness = await getReadiness();
  const body =
    readiness.status === "ok"
      ? { status: readiness.status, version: readiness.version }
      : { status: readiness.status };
  return NextResponse.json(body, { status: readiness.httpStatus, headers });
}
