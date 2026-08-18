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
      finalized: result.finalized,
      message: result.created
        ? `已生成应收订单草稿 ${result.receivableOrder.orderNo}；柜号可在提柜后补充`
        : result.finalized
          ? `装柜已最终确认，供应商货款将按实装数量结算`
          : `应收订单草稿已存在：${result.receivableOrder.orderNo}`,
    });
  } catch (error: unknown) {
    return apiError(error, "销售执行单发货流程操作失败");
  }
}
