import type { NextRequest } from "next/server";
import { apiError, getActor, ok, parseJsonBody, settleCommission } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { orderId } = await params;
    const body = await parseJsonBody(request, { allowEmpty: true });
    const order = await settleCommission(request, actor, orderId, body);
    return ok({ success: true, order, message: "业务员提成已结算" });
  } catch (error: unknown) {
    return apiError(error, "结算业务员提成失败");
  }
}
