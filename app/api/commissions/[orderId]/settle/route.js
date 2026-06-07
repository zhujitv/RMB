import { apiError, getActor, ok, settleCommission } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const actor = await getActor(request);
    const body = await request.json().catch(() => ({}));
    const order = await settleCommission(request, actor, params.orderId, body);
    return ok({ success: true, order, message: "业务员提成已结算" });
  } catch (error) {
    return apiError(error, "结算业务员提成失败");
  }
}
