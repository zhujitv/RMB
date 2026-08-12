import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { completeSupplierPurchaseOrderProduction } from "../../../../../lib/platform/supplier-purchase-order-production";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "supplierPurchaseOrders");
    const { id } = await params;
    const body = await parseJsonBody(request);
    const purchaseOrder = await completeSupplierPurchaseOrderProduction(request, actor, id, body);
    return NextResponse.json({
      success: true,
      purchaseOrder,
      data: purchaseOrder,
      message: "生产完成已确认",
    });
  } catch (error: unknown) {
    return apiError(error, "确认工厂采购单生产完成失败");
  }
}
