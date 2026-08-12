import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { addFactoryPurchaseOrderAdjustment } from "../../../../../../../lib/platform/factory-purchase-order-execution";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, purchaseOrderId } = await params;
    const adjustment = await addFactoryPurchaseOrderAdjustment(request, actor, id, purchaseOrderId, await parseJsonBody(request));
    return NextResponse.json({ success: true, adjustment, data: adjustment, message: "临时费用已登记，最终结算前仍为暂估" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "登记工厂临时费用失败");
  }
}
