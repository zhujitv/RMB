import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { submitSupplierFactoryPurchaseLoadingResult } from "../../../../../lib/platform/supplier-purchase-order-loading-result";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "supplierPurchaseOrders");
    const { id } = await params;
    const result = await submitSupplierFactoryPurchaseLoadingResult(
      request,
      actor,
      id,
      await parseJsonBody(request),
    );
    return NextResponse.json({
      success: true,
      data: result,
      result,
      message: result.loadingResult.status === "APPROVED"
        ? "最终装柜结果已提交，数量无差异并已自动批准"
        : "最终装柜差异已提交，等待内部审批",
    });
  } catch (error: unknown) {
    return apiError(error, "提交最终装柜结果失败");
  }
}
