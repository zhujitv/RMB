import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { reassignRejectedFactoryPurchaseOrder } from "../../../../../../../lib/platform/factory-purchase-order-reassignment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const result = await reassignRejectedFactoryPurchaseOrder(
      request,
      actor,
      id,
      purchaseOrderId,
      await parseJsonBody(request),
    );
    return NextResponse.json({
      success: true,
      data: result.execution,
      ...result,
      message: "已重新选择工厂并单独下发新采购单",
    });
  } catch (error: unknown) {
    return apiError(error, "重新选择工厂并下发采购单失败");
  }
}
