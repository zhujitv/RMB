import type { NextRequest } from "next/server";
import { apiError, deleteOrderDocument, getActor, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const document = await deleteOrderDocument(request, actor, id);
    return ok({ success: true, document, message: "单证已删除" });
  } catch (error: unknown) {
    return apiError(error, "删除订单单证失败");
  }
}
