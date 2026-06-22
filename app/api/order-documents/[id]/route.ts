import type { NextRequest } from "next/server";
import { apiError, deleteOrderDocument, getActor, getOrderDocumentMetadata, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const document = await getOrderDocumentMetadata(request, actor, id);
    return ok({ success: true, document });
  } catch (error: unknown) {
    return apiError(error, "读取订单单证失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const document = await deleteOrderDocument(request, actor, id);
    return ok({ success: true, document, message: "已删除文件" });
  } catch (error: unknown) {
    return apiError(error, "删除失败，请重试");
  }
}
