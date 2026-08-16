import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { releaseSalesExecutionContainerLoad } from "../../../../../../../lib/platform/sales-execution-container-loads";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string; containerLoadId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, containerLoadId } = await params;
    const containerLoad = await releaseSalesExecutionContainerLoad(request, actor, id, containerLoadId, await parseJsonBody(request));
    return NextResponse.json({ success: true, data: containerLoad, containerLoad, message: "集装箱已放行并冻结" });
  } catch (error: unknown) {
    return apiError(error, "放行集装箱失败");
  }
}
