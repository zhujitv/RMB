import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, refreshExchangeRates } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request, { allowEmpty: true });
    return ok(await refreshExchangeRates(request, actor, body));
  } catch (error: unknown) {
    return apiError(error, "刷新汇率失败");
  }
}
