import type { NextRequest } from "next/server";
import { apiError, getActor, getProfitAnalysis, listProfitAnalysisPage, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    if (query.has("page") || query.has("pageSize")) {
      return ok({ data: await listProfitAnalysisPage(query, actor) });
    }
    return ok({ rows: await getProfitAnalysis(query, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取利润分析失败");
  }
}
