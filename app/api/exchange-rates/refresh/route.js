import { apiError, getActor, ok, refreshExchangeRates } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json().catch(() => ({}));
    return ok(await refreshExchangeRates(request, actor, body));
  } catch (error) {
    return apiError(error, "刷新汇率失败");
  }
}
