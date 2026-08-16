import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { requestSupplierDeliveryQuantityVariance } from "../../../../../lib/platform/supplier-purchase-order-delivery-quantity-variance";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "supplierPurchaseOrders");
    const { id } = await params;
    const body = await parseJsonBody(request);
    const result = await requestSupplierDeliveryQuantityVariance(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: result,
      result,
      message: "交付数量差异申请已提交，等待内部审批",
    });
  } catch (error: unknown) {
    return apiError(error, "提交交付数量差异申请失败");
  }
}
