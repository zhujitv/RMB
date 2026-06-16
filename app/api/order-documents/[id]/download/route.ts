import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, getOrderDocumentDownload } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const { url } = await getOrderDocumentDownload(request, actor, id);
    return NextResponse.redirect(url);
  } catch (error: unknown) {
    return apiError(error, "下载订单单证失败");
  }
}
