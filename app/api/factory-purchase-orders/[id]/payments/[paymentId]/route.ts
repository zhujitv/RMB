import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../lib/platform-db";
import { voidFactoryPurchaseOrderPayment } from "../../../../../../lib/platform/factory-purchase-order-ledger-void";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; paymentId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, paymentId } = await params;
    const payment = await voidFactoryPurchaseOrderPayment(request, actor, id, paymentId, await parseJsonBody(request));
    return NextResponse.json({ success: true, payment, data: payment, message: "采购付款已冲销" });
  } catch (error: unknown) {
    return apiError(error, "冲销工厂采购付款失败");
  }
}
