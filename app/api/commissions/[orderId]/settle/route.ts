import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  parseJsonBody,
  reverseCommissionSettlement,
  settleCommission,
} from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    const body = await parseJsonBody(request, { allowEmpty: true });
    const order = await settleCommission(request, actor, orderId, body);
    return ok({ success: true, order, message: "业务员提成已结算" });
  } catch (error: unknown) {
    return apiError(error, "结算业务员提成失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    const body = await parseJsonBody(request);
    const order = await reverseCommissionSettlement(request, actor, orderId, body);
    return ok({ success: true, order, message: "业务员提成结算已撤销" });
  } catch (error: unknown) {
    return apiError(error, "撤销业务员提成结算失败");
  }
}
