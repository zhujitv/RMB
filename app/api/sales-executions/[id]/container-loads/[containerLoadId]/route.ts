import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../lib/platform-db";
import { updateSalesExecutionContainerLoad } from "../../../../../../lib/platform/sales-execution-container-loads";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string; containerLoadId: string }> };

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, containerLoadId } = await params;
    const containerLoad = await updateSalesExecutionContainerLoad(request, actor, id, containerLoadId, await parseJsonBody(request));
    return NextResponse.json({ success: true, data: containerLoad, containerLoad, message: "集装箱装柜草稿已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存集装箱装柜草稿失败");
  }
}
