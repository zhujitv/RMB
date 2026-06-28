import type { NextRequest } from "next/server";
import { apiError, getProfitAnalysis, listProfitAnalysisPage, logServerError, ok } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let actor: Awaited<ReturnType<typeof requireApiActor>>;
  try {
    actor = await requireApiActor(request);
  } catch (error: unknown) {
    return apiError(error, "读取利润分析失败");
  }
  const query = new URL(request.url).searchParams;
  try {
    if (query.has("page") || query.has("pageSize")) {
      return ok({ data: await listProfitAnalysisPage(query, actor) });
    }
    return ok({ rows: await getProfitAnalysis(query, actor) });
  } catch (error: unknown) {
    logServerError("API failed: profit-analysis list", error);
    const page = Math.max(1, Number.parseInt(query.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.get("pageSize") || "20", 10) || 20));
    if (query.has("page") || query.has("pageSize")) {
      return ok({
        data: { rows: [], total: 0, page, pageSize, totalPages: 1 },
        error: "读取资料失败",
      });
    }
    return ok({ rows: [], error: "读取资料失败" });
  }
}
