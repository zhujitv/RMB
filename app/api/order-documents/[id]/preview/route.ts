import type { NextRequest } from "next/server";
import { getActor, getOrderDocumentPreview, getOrderDocumentPreviewMetadata, pdfContentDispositionHeader, preferredOrderDocumentFileName } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
};

function previewErrorResponse(error: ErrorLike) {
  const status = error?.status || 500;
  const code = error?.code || (status === 403 ? "PERMISSION_DENIED" : "R2_STREAM_FAILED");
  const message = error?.message || "PDF 预览失败，请下载原文件查看";
  return Response.json({ error: message, code }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Preview-Error-Code": code,
    },
  });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const { body, document } = await getOrderDocumentPreview(request, actor, id);
    const fileName = preferredOrderDocumentFileName(document);
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.length),
        "Content-Disposition": pdfContentDispositionHeader("inline", fileName),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return previewErrorResponse((error || {}) as ErrorLike);
  }
}

export async function HEAD(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const document = await getOrderDocumentPreviewMetadata(request, actor, id);
    const fileName = preferredOrderDocumentFileName(document);
    return new Response(null, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": pdfContentDispositionHeader("inline", fileName),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return previewErrorResponse((error || {}) as ErrorLike);
  }
}
