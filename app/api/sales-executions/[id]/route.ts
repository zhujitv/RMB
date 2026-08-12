import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseJsonBody } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";
import {
  getSalesExecution,
  updateSalesExecution,
  voidSalesExecution,
} from "../../../../lib/platform/sales-execution-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const execution = await getSalesExecution(id, actor);
    return NextResponse.json({ success: true, data: execution, execution });
  } catch (error: unknown) {
    return apiError(error, "读取销售执行单详情失败");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const execution = await updateSalesExecution(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: execution,
      execution,
      message: "销售执行单草稿已更新并生成新版本",
    });
  } catch (error: unknown) {
    return apiError(error, "更新销售执行单失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request, { allowEmpty: true });
    const execution = await voidSalesExecution(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: execution,
      execution,
      message: "销售执行单已作废",
    });
  } catch (error: unknown) {
    return apiError(error, "作废销售执行单失败");
  }
}
