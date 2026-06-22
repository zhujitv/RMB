import type { NextRequest } from "next/server";
import { apiError, deleteLogisticsExpense, getActor, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const expense = await deleteLogisticsExpense(request, actor, id);
    return ok({ success: true, expense, message: "已删除" });
  } catch (error: unknown) {
    return apiError(error, "删除物流费用明细失败");
  }
}
