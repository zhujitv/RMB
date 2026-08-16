import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { voidSalesExecutionContainerLoad } from "../../../../../../../lib/platform/sales-execution-container-loads";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string; containerLoadId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, containerLoadId } = await params;
    const containerLoad = await voidSalesExecutionContainerLoad(request, actor, id, containerLoadId, await parseJsonBody(request));
    return NextResponse.json({ success: true, data: containerLoad, containerLoad, message: "集装箱已作废" });
  } catch (error: unknown) {
    return apiError(error, "作废集装箱失败");
  }
}
