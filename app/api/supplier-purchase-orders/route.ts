import { NextResponse, type NextRequest } from "next/server";
import { requireApiRead } from "../../../lib/api-route-guard";
import { apiError } from "../../../lib/platform-db";
import { listSupplierPurchaseOrders } from "../../../lib/platform/supplier-purchase-orders";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiRead(request, "supplierPurchaseOrders");
    const result = await listSupplierPurchaseOrders(new URL(request.url).searchParams, actor);
    return NextResponse.json({
      success: true,
      purchaseOrders: result.rows,
      data: result.rows,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取工厂采购单失败");
  }
}
