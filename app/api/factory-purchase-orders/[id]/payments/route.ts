import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { recordFactoryPurchaseOrderPayment } from "../../../../../lib/platform/factory-purchase-order-execution";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const payment = await recordFactoryPurchaseOrderPayment(request, actor, id, await parseJsonBody(request));
    return NextResponse.json({ success: true, payment, data: payment, message: "工厂采购付款已登记" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "登记工厂采购付款失败");
  }
}
