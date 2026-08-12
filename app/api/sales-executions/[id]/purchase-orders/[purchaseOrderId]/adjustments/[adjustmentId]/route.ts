import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../../lib/platform-db";
import { voidFactoryPurchaseOrderAdjustment } from "../../../../../../../../lib/platform/factory-purchase-order-ledger-void";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string; adjustmentId: string }> };

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, purchaseOrderId, adjustmentId } = await params;
    const adjustment = await voidFactoryPurchaseOrderAdjustment(
      request,
      actor,
      id,
      purchaseOrderId,
      adjustmentId,
      await parseJsonBody(request),
    );
    return NextResponse.json({ success: true, adjustment, data: adjustment, message: "采购费用调整已作废" });
  } catch (error: unknown) {
    return apiError(error, "作废工厂采购费用调整失败");
  }
}
