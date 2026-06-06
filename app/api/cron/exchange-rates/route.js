import { apiError, ok, refreshExchangeRatesForDate } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (process.env.NODE_ENV === "production" && !secret) {
      return Response.json({ error: "CRON_SECRET 未配置" }, { status: 403 });
    }
    if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return ok(await refreshExchangeRatesForDate());
  } catch (error) {
    return apiError(error, "自动更新汇率失败");
  }
}
