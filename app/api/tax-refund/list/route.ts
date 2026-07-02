import type { NextRequest } from "next/server";
import { apiError, listTaxRefundOrders, logServerError, ok } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let actor: Awaited<ReturnType<typeof requireApiActor>>;
  try {
    actor = await requireApiActor(request);
  } catch (error: unknown) {
    return apiError(error, "读取退税资料失败");
  }
  const query = new URL(request.url).searchParams;
  try {
    return ok(await listTaxRefundOrders(query, actor));
  } catch (error: unknown) {
    logServerError("API failed: tax-refund lightweight list", error);
    const page = Math.max(1, Number.parseInt(query.get("page") || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(query.get("pageSize") || "20", 10) || 20));
    return ok({
      orders: [],
      pagination: { page, pageSize, total: 0, totalPages: 1 },
      query: query.get("keyword") || "",
      mode: query.get("mode") === "archive" ? "archive" : "current",
      error: "读取资料失败",
    });
  }
}
