import { apiError, archiveDomesticLogisticsOrders, getActor, ok, parseJsonBody } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const result = await archiveDomesticLogisticsOrders(request, actor, body);
    return ok({ ...result, message: `已归档 ${result.archivedCount} 个订单` });
  } catch (error: unknown) {
    return apiError(error, "批量归档物流信息失败");
  }
}
