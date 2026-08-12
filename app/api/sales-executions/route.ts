import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseJsonBody } from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";
import {
  createSalesExecution,
  listSalesExecutions,
} from "../../../lib/platform/sales-execution-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const data = await listSalesExecutions(new URL(request.url).searchParams, actor);
    return NextResponse.json({ success: true, data, executions: data.rows });
  } catch (error: unknown) {
    return apiError(error, "读取销售执行单失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const execution = await createSalesExecution(request, actor, body);
    return NextResponse.json({
      success: true,
      data: execution,
      execution,
      message: "销售执行单草稿已创建",
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "创建销售执行单失败");
  }
}
