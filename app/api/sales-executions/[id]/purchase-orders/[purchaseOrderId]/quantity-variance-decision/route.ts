import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { decideDeliveryQuantityVariance } from "../../../../../../../lib/platform/factory-purchase-order-delivery-quantity-variance-decision";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const body = await parseJsonBody(request);
    const result = await decideDeliveryQuantityVariance(
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
      message: result.variance.status === "APPROVED"
        ? "交付数量差异申请已批准"
        : "交付数量差异申请已拒绝",
    });
  } catch (error: unknown) {
    return apiError(error, "审批交付数量差异申请失败");
  }
}
