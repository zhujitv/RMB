import { NextResponse } from "next/server";
import { apiError, deleteOrder, getActor, getOrder, ok, saveOrder } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    return ok({ order: await getOrder(id, actor) });
  } catch (error) {
    return apiError(error, "读取应收订单失败");
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    const order = await saveOrder(request, actor, body, id);
    return NextResponse.json({
      success: true,
      data: order,
      order,
      message: "订单保存成功",
    });
  } catch (error) {
    const status = error?.status || 500;
    return NextResponse.json({
      success: false,
      errorCode: error?.code || "ORDER_SAVE_FAILED",
      message: error?.message || "更新应收订单失败",
    }, { status });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteOrder(request, actor, id);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "删除应收订单失败");
  }
}
