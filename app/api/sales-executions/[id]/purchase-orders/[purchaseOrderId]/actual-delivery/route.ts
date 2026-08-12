import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { recordFactoryPurchaseOrderActualDelivery } from "../../../../../../../lib/platform/factory-purchase-order-delivery";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const purchaseOrder = await recordFactoryPurchaseOrderActualDelivery(
      request,
      actor,
      id,
      purchaseOrderId,
      await parseJsonBody(request),
    );
    return NextResponse.json({
      success: true,
      purchaseOrder,
      data: purchaseOrder,
      message: "实际交付日期已登记",
    });
  } catch (error: unknown) {
    return apiError(error, "登记工厂采购单实际交付日期失败");
  }
}
