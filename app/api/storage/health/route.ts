import type { NextRequest } from "next/server";
import { apiError, assertWrite, ok } from "../../../../lib/platform-db";
import { checkR2Storage } from "../../../../lib/r2";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertWrite(actor, "settings");
    return ok({ storage: await checkR2Storage() });
  } catch (error: unknown) {
    return apiError(error, "检查文件存储服务失败");
  }
}
