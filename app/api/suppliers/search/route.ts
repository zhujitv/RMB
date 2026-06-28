import type { NextRequest } from "next/server";
import { apiError, listAvailableSuppliers, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const params = new URL(request.url).searchParams;
    return ok({ suppliers: await listAvailableSuppliers(params, actor) });
  } catch (error: unknown) {
    return apiError(error, "搜索供应商失败");
  }
}
