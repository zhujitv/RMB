import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { createSalesExecutionContainerLoad } from "../../../../../lib/platform/sales-execution-container-loads";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const containerLoad = await createSalesExecutionContainerLoad(request, actor, id, await parseJsonBody(request));
    return NextResponse.json({ success: true, data: containerLoad, containerLoad, message: "集装箱装柜草稿已创建" });
  } catch (error: unknown) {
    return apiError(error, "创建集装箱装柜草稿失败");
  }
}
