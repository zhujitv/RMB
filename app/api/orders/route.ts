import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, listOrders, ok, saveOrder } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

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

const listOrdersTyped = listOrders as (
  query: URLSearchParams,
  actor: unknown,
  options?: { paginated?: boolean },
) => Promise<unknown[] | { rows: unknown[] }>;

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const paginated = query.get("workspace") === "1" || query.has("page") || query.has("pageSize");
    const result = await listOrdersTyped(query, actor, { paginated });
    const page = result as { rows: unknown[] };
    return paginated
      ? ok({ success: true, data: result, orders: page.rows || [] })
      : ok({ orders: result });
  } catch (error: unknown) {
    return apiError(error, "读取应收订单失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const order = await saveOrderTyped(request, actor, body);
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
      message: typedError.message || "保存应收订单失败",
    }, { status });
  }
}
