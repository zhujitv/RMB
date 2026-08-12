import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { decideFactoryPurchaseOrderDeliveryProposal } from "../../../../../../../lib/platform/factory-purchase-order-delivery";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const result = await decideFactoryPurchaseOrderDeliveryProposal(
      request,
      actor,
      id,
      purchaseOrderId,
      await parseJsonBody(request),
    );
    return NextResponse.json({
      success: true,
      decision: result.decision,
      purchaseOrder: result.purchaseOrder,
      data: result.purchaseOrder,
      message: result.decision === "ACCEPTED" ? "供应商新交期已接受" : "供应商新交期已拒绝",
    });
  } catch (error: unknown) {
    return apiError(error, "处理供应商新交期失败");
  }
}
