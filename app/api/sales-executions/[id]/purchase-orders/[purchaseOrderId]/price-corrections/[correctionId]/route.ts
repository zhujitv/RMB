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
    const result = await reviewFactoryPurchaseOrderPriceCorrection(
      request,
      actor,
      id,
      purchaseOrderId,
      correctionId,
      await parseJsonBody(request),
    );
    const isBatch = result && typeof result === "object" && "corrections" in result;
    const corrections = (isBatch ? result.corrections : [result]) as Array<{
      id?: string;
      status: string;
      deltaAmount?: unknown;
    }>;
    const correction = corrections.find((row) => row.id === correctionId) || corrections[0] || null;
    return NextResponse.json({
      success: true,
      correction,
      corrections,
      batchId: isBatch ? result.batchId : null,
      totalDeltaAmount: isBatch ? result.totalDeltaAmount : correction?.deltaAmount || null,
      data: isBatch ? result : correction,
      message: isBatch ? "批量采购价格更正已整批审核保存" : "采购价格更正审核已保存",
    });
  } catch (error: unknown) {
    return apiError(error, "审核采购价格更正失败");
  }
}
