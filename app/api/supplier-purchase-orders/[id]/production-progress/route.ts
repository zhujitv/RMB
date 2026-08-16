import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { recordSupplierPurchaseOrderProductionProgress } from "../../../../../lib/platform/supplier-purchase-order-production-progress";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "supplierPurchaseOrders");
    const { id } = await params;
    const body = await parseJsonBody(request);
    const purchaseOrder = await recordSupplierPurchaseOrderProductionProgress(
      request,
      actor,
      id,
      body,
    );
    return NextResponse.json({
      success: true,
      purchaseOrder,
      data: purchaseOrder,
      message: "生产进度已提交",
    });
  } catch (error: unknown) {
    return apiError(error, "提交工厂采购单生产进度失败");
  }
}
