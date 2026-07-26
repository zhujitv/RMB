import { NextResponse, type NextRequest } from "next/server";
import { apiError, apiErrorWithLegacyShape, deleteOrder, getOrder, ok, parseJsonBody, saveOrder } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const saveOrderTyped = saveOrder as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    return ok({ order: await getOrder(id, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取应收订单失败");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const order = await saveOrderTyped(request, actor, body, id);
    return NextResponse.json({
      success: true,
      data: order,
      order,
      message: "订单保存成功",
    });
  } catch (error: unknown) {
    return apiErrorWithLegacyShape(error, "更新应收订单失败", "ORDER_SAVE_FAILED");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    await deleteOrder(request, actor, id);
    return ok({ ok: true });
  } catch (error: unknown) {
    return apiError(error, "删除应收订单失败");
  }
}
