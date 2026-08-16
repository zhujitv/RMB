import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { requestOfflineDeliveryQuantityVariance } from "../../../../../../../lib/platform/factory-purchase-order-offline-delivery-quantity-variance";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const body = await parseJsonBody(request);
    const result = await requestOfflineDeliveryQuantityVariance(
      request,
      actor,
      id,
      purchaseOrderId,
      body,
    );
    return NextResponse.json({
      success: true,
      data: result,
      result,
      message: "供应商线下交付数量差异申请已登记，等待审批",
    });
  } catch (error: unknown) {
    return apiError(error, "登记供应商线下交付数量差异申请失败");
  }
}
