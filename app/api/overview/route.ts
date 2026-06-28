import type { NextRequest } from "next/server";
import { apiError, getOverview, ok, requireAdminGlobal } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    requireAdminGlobal(actor, "无权限访问经营总览");
    return ok({ overview: await getOverview(new URL(request.url).searchParams, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取总览失败");
  }
}
