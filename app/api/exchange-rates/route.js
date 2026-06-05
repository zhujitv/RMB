import { apiError, assertWrite, getActor, getExchangeRateQuote, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const forceRefresh = query.get("force") === "1";
    if (forceRefresh) assertWrite(actor, "exchangeRates");
    return ok({
      rate: await getExchangeRateQuote({
        currency: query.get("currency"),
        rateDate: query.get("date") || query.get("rateDate"),
        source: query.get("source"),
        rateType: query.get("rateType"),
        forceRefresh,
      }, actor),
    });
  } catch (error) {
    return apiError(error, "读取汇率失败");
  }
}
