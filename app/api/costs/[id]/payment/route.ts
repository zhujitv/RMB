import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, updateProductSupplierCostPayment } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const cost = await updateProductSupplierCostPayment(request, actor, id, body as Record<string, unknown>);
    return ok({ success: true, cost });
  } catch (error: unknown) {
    return apiError(error, "更新成本付款信息失败");
  }
}
