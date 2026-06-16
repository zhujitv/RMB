import { NextResponse, type NextRequest } from "next/server";
import { apiError, deleteOrder, getActor, getOrder, ok, saveOrder } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
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
    const actor = await getActor(request);
    return ok({ order: await getOrder(id, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取应收订单失败");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const order = await saveOrderTyped(request, actor, body, id);
    return NextResponse.json({
      success: true,
      data: order,
      order,
      message: "订单保存成功",
    });
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    const status = typedError.status || 500;
    return NextResponse.json({
      success: false,
      errorCode: typedError.code || "ORDER_SAVE_FAILED",
      message: typedError.message || "更新应收订单失败",
    }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteOrder(request, actor, id);
    return ok({ ok: true });
  } catch (error: unknown) {
    return apiError(error, "删除应收订单失败");
  }
}
