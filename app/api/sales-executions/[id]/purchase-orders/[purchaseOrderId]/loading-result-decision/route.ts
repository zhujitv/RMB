import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { decideFactoryPurchaseLoadingResult } from "../../../../../../../lib/platform/factory-purchase-order-loading-result-decision";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const result = await decideFactoryPurchaseLoadingResult(
      request,
      actor,
      id,
      purchaseOrderId,
      await parseJsonBody(request),
    );
    return NextResponse.json({
      success: true,
      data: result,
      result,
      message: result.loadingResult.status === "APPROVED"
        ? "装柜差异已批准"
        : "装柜差异已拒绝",
    });
  } catch (error: unknown) {
    return apiError(error, "审批装柜差异失败");
  }
}
