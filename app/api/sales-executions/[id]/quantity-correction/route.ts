import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { correctSalesExecutionQuantity } from "../../../../../lib/platform/sales-execution-quantity-correction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id } = await params;
    const body = await parseJsonBody(request);
    const execution = await correctSalesExecutionQuantity(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: execution,
      execution,
      message: "订单数量已更正，应收和工厂采购金额已同步更新",
    });
  } catch (error: unknown) {
    return apiError(error, "更正已下发订单数量失败");
  }
}
