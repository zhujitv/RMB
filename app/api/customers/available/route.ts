import type { NextRequest } from "next/server";
import { apiError, listAvailableCustomers, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ customers: await listAvailableCustomers(new URL(request.url).searchParams, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取可用客户失败");
  }
}
