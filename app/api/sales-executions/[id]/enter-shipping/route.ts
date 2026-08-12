import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { enterSalesExecutionShipping } from "../../../../../lib/platform/sales-execution-shipping-handoff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const input = await parseJsonBody(request);
    const result = await enterSalesExecutionShipping(request, actor, id, input);
    return NextResponse.json({
      success: true,
      data: result.execution,
      execution: result.execution,
      receivableOrder: result.receivableOrder,
      created: result.created,
      message: result.created
        ? `已进入发货，并生成应收订单草稿 ${result.receivableOrder.orderNo}`
        : `该销售执行单已进入发货，应收订单草稿为 ${result.receivableOrder.orderNo}`,
    });
  } catch (error: unknown) {
    return apiError(error, "销售执行单进入发货失败");
  }
}
