import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { settleFactoryPurchaseOrder } from "../../../../../../../lib/platform/factory-purchase-order-settlement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, purchaseOrderId } = await params;
    const settlement = await settleFactoryPurchaseOrder(
      request,
      actor,
      id,
      purchaseOrderId,
      await parseJsonBody(request),
    );
    return NextResponse.json({
      success: true,
      settlement,
      data: settlement,
      message: settlement.status === "SETTLED" ? "工厂采购已结清" : "工厂最终应付已确认，等待尾款",
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "工厂采购结算失败");
  }
}
