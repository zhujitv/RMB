import { NextResponse, type NextRequest } from "next/server";
import { requireApiRead } from "../../../../lib/api-route-guard";
import { apiError } from "../../../../lib/platform-db";
import { getSupplierPurchaseOrder } from "../../../../lib/platform/supplier-purchase-orders";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiRead(request, "supplierPurchaseOrders");
    const { id } = await params;
    const purchaseOrder = await getSupplierPurchaseOrder(id, actor);
    return NextResponse.json({ success: true, purchaseOrder, data: purchaseOrder });
  } catch (error: unknown) {
    return apiError(error, "读取工厂采购单详情失败");
  }
}
