import { type NextRequest } from "next/server";
import { apiError, getSupplierDocumentRequestStats, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    const stats = await getSupplierDocumentRequestStats(query, actor);
    return ok({ stats });
  } catch (error: unknown) {
    return apiError(error, "读取资料回传统计失败");
  }
}
