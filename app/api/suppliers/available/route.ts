import type { NextRequest } from "next/server";
import { apiError, listAvailableSuppliers, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ suppliers: await listAvailableSuppliers(new URL(request.url).searchParams, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取可用供应商失败");
  }
}
