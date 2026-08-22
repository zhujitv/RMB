import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { requestFactoryPurchaseOrderPriceCorrection } from "../../../../../../../lib/platform/factory-purchase-order-price-correction";
import { requestFactoryPurchaseOrderPriceCorrectionBatch } from "../../../../../../../lib/platform/factory-purchase-order-price-correction-batch-request";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, purchaseOrderId } = await params;
    const input = await parseJsonBody(request);
    if (input && typeof input === "object" && Array.isArray((input as { items?: unknown }).items)) {
      const batch = await requestFactoryPurchaseOrderPriceCorrectionBatch(
        request,
        actor,
        id,
        purchaseOrderId,
        input,
      );
      return NextResponse.json({
        success: true,
        correction: batch.corrections[0] || null,
        corrections: batch.corrections,
        batchId: batch.batchId,
        totalDeltaAmount: batch.totalDeltaAmount,
        data: batch,
        message: "批量采购价格更正申请已提交，等待管理员整批审核",
      }, { status: 201 });
    }
    const correction = await requestFactoryPurchaseOrderPriceCorrection(
      request,
      actor,
      id,
      purchaseOrderId,
      input,
    );
    return NextResponse.json({ success: true, correction, data: correction, message: "采购价格更正申请已提交，等待管理员审核" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "提交采购价格更正申请失败");
  }
}
