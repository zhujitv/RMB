import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { replaceFactoryPurchaseOrderDrafts } from "../../../../../lib/platform/sales-execution-purchase-orders";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const execution = await replaceFactoryPurchaseOrderDrafts(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: execution,
      execution,
      message: "工厂采购单草稿已保存",
    });
  } catch (error: unknown) {
    return apiError(error, "保存工厂采购单草稿失败");
  }
}
