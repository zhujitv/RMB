import type { NextRequest } from "next/server";
import { apiError, getActor, listTaxRefundOrders, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return ok(await listTaxRefundOrders(query, actor));
  } catch (error: unknown) {
    return apiError(error, "读取退税资料失败");
  }
}
