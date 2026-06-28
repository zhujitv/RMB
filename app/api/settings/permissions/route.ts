import type { NextRequest } from "next/server";
import { apiError, getPermissionConfig, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ permissions: getPermissionConfig(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取权限配置失败");
  }
}
