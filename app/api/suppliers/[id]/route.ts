import type { NextRequest } from "next/server";
import { apiError, deleteSupplier, ok, parseJsonBody, saveSupplier } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const saveSupplierTyped = saveSupplier as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const supplier = await saveSupplierTyped(request, actor, body, id);
    return ok({ success: true, supplier, message: "供应商已保存" });
  } catch (error: unknown) {
    return apiError(error, "更新供应商失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    await deleteSupplier(request, actor, id);
    return ok({ success: true, ok: true, message: "供应商已删除" });
  } catch (error: unknown) {
    return apiError(error, "删除供应商失败");
  }
}
