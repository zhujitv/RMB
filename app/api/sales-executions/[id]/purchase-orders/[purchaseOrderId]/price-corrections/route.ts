import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { requestFactoryPurchaseOrderPriceCorrection } from "../../../../../../../lib/platform/factory-purchase-order-price-correction";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, purchaseOrderId } = await params;
    const correction = await requestFactoryPurchaseOrderPriceCorrection(
      request,
      actor,
      id,
      purchaseOrderId,
      await parseJsonBody(request),
    );
    return NextResponse.json({ success: true, correction, data: correction, message: "采购价格更正申请已提交，等待管理员审核" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "提交采购价格更正申请失败");
  }
}
