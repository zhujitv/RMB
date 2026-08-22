import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../../lib/platform-db";
import { reviewFactoryPurchaseOrderPriceCorrection } from "../../../../../../../../lib/platform/factory-purchase-order-price-correction";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string; correctionId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, purchaseOrderId, correctionId } = await params;
    const correction = await reviewFactoryPurchaseOrderPriceCorrection(
      request,
      actor,
      id,
      purchaseOrderId,
      correctionId,
      await parseJsonBody(request),
    );
    return NextResponse.json({ success: true, correction, data: correction, message: "采购价格更正审核已保存" });
  } catch (error: unknown) {
    return apiError(error, "审核采购价格更正失败");
  }
}
