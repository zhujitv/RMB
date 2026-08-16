import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { submitOfflineFactoryPurchaseLoadingResult } from "../../../../../../../lib/platform/factory-purchase-order-offline-loading-result";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const result = await submitOfflineFactoryPurchaseLoadingResult(
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
        ? "线下装柜结果已登记，数量无差异并已自动批准"
        : "线下装柜差异已登记，等待审批",
    });
  } catch (error: unknown) {
    return apiError(error, "登记线下最终装柜结果失败");
  }
}
