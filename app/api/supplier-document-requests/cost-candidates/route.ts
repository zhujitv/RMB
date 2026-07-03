import type { NextRequest } from "next/server";
import { apiError, listSupplierDocumentRequestCostCandidates, ok } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ costs: await listSupplierDocumentRequestCostCandidates(query, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取可回传工厂成本失败");
  }
}
