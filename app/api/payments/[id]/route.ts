import type { NextRequest } from "next/server";
import { apiError, deletePayment, getActor, ok, savePayment } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const savePaymentTyped = savePayment as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const payment = await savePaymentTyped(request, actor, body, id);
    return ok({ success: true, payment, message: "收款已保存" });
  } catch (error: unknown) {
    return apiError(error, "更新收款失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deletePayment(request, actor, id);
    return ok({ success: true, ok: true, message: "收款已删除" });
  } catch (error: unknown) {
    return apiError(error, "删除收款失败");
  }
}
