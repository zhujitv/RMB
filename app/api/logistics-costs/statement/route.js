import { apiError, getActor, logisticsSupplierStatement, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const rows = await logisticsSupplierStatement(new URL(request.url).searchParams, actor);
    return ok({ success: true, rows });
  } catch (error) {
    return apiError(error, "读取物流供应商对账单失败");
  }
}
