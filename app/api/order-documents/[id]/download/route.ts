import { apiError, getActor, getOrderDocumentDownload } from "../../../../../lib/platform-db";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function asciiFileName(name = "document") {
  const cleaned = String(name || "document")
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\/:*?<>|]+/g, "_");
  const withPdfSuffix = /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned || "document"}.pdf`;
  return withPdfSuffix || "document.pdf";
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const { body, document } = await getOrderDocumentDownload(request, actor, id);
    const fileName = asciiFileName(document.originalFilename || document.originalName || document.fileName || "document");
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.length),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "下载订单单证失败");
  }
}
