import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { respondToSupplierPurchaseOrder } from "../../../../../lib/platform/supplier-purchase-orders";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "supplierPurchaseOrders");
    const { id } = await params;
    const body = await parseJsonBody(request);
    const purchaseOrder = await respondToSupplierPurchaseOrder(request, actor, id, body);
    return NextResponse.json({
      success: true,
      purchaseOrder,
      data: purchaseOrder,
      message: "采购单回复已提交，后续如需调整请联系采购人员",
    });
  } catch (error: unknown) {
    return apiError(error, "提交工厂采购单回复失败");
  }
}
