import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../../../lib/platform-db";
import { updateFactoryPurchaseOrderProduction } from "../../../../../../../lib/platform/factory-purchase-order-execution";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const body = await parseJsonBody(request);
    await updateFactoryPurchaseOrderProduction(request, actor, id, purchaseOrderId, body.action);
    return NextResponse.json({ success: true, message: "该工厂已进入生产" });
  } catch (error: unknown) {
    return apiError(error, "更新工厂生产状态失败");
  }
}
