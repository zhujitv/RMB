import type { NextRequest } from "next/server";
import { apiError, deleteCustomer, getActor, ok, parseJsonBody, saveCustomer } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const saveCustomerTyped = saveCustomer as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const customer = await saveCustomerTyped(request, actor, body, id);
    return ok({
      success: true,
      data: customer,
      message: "客户资料已保存",
    });
  } catch (error: unknown) {
    return apiError(error, "更新客户失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    await deleteCustomer(request, actor, id);
    return ok({ ok: true });
  } catch (error: unknown) {
    return apiError(error, "删除客户失败");
  }
}
