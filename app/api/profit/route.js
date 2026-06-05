import { apiError, getActor, getProfitAnalysis, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ rows: await getProfitAnalysis(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取利润分析失败");
  }
}
