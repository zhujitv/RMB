import type { NextRequest } from "next/server";
import { apiError, assertWrite, getExchangeRateQuote, ok } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

const getExchangeRateQuoteTyped = getExchangeRateQuote as (
  input: {
    currency: string | null;
    rateDate: string | null;
    source: string | null;
    rateType: string | null;
    forceRefresh: boolean;
    cacheOnly: boolean;
  },
  actor: unknown,
) => Promise<unknown>;

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    const forceRefresh = query.get("force") === "1";
    if (forceRefresh) assertWrite(actor, "exchangeRates");
    return ok({
      rate: await getExchangeRateQuoteTyped({
        currency: query.get("currency"),
        rateDate: query.get("date") || query.get("rateDate"),
        source: query.get("source"),
        rateType: query.get("rateType"),
        forceRefresh,
        cacheOnly: query.get("cacheOnly") === "1",
      }, actor),
    });
  } catch (error: unknown) {
    return apiError(error, "读取汇率失败");
  }
}
