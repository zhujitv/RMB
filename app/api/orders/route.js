import { NextResponse } from "next/server";
import { apiError, getActor, listOrders, ok, saveOrder } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ orders: await listOrders(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取应收订单失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const order = await saveOrder(request, actor, body);
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
      message: error?.message || "保存应收订单失败",
    }, { status });
  }
}
