import { apiError, getActor, getOrderDocumentDownload, pdfContentDispositionHeader, preferredOrderDocumentFileName } from "../../../../../lib/platform-db";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const { body, document } = await getOrderDocumentDownload(request, actor, id);
    const fileName = preferredOrderDocumentFileName(document);
    const disposition = request.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.length),
        "Content-Disposition": pdfContentDispositionHeader(disposition, fileName),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "下载订单单证失败");
  }
}
