import type { NextRequest } from "next/server";
import {
  apiErrorSafe500,
  getOrderDocumentPreview,
  getOrderDocumentPreviewMetadata,
  managedFileStreamHeaders,
  preferredOrderDocumentFileName,
} from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

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

async function previewErrorResponse(error: ErrorLike) {
  const status = error?.status || 500;
  const code = error?.code || (status === 403 ? "PERMISSION_DENIED" : "STORAGE_STREAM_FAILED");
  const response = await apiErrorSafe500(error, "文件暂时无法预览，请下载查看。", code);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Preview-Error-Code", code);
  return response;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const { body, mimeType, document } = await getOrderDocumentPreview(request, actor, id);
    const fileName = preferredOrderDocumentFileName(document);
    return new Response(new Uint8Array(body), {
      headers: managedFileStreamHeaders({
        bodyLength: body.length,
        mimeType,
        fileName,
        disposition: "inline",
      }),
    });
  } catch (error: unknown) {
    return previewErrorResponse((error || {}) as ErrorLike);
  }
}

export async function HEAD(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const document = await getOrderDocumentPreviewMetadata(request, actor, id);
    const fileName = preferredOrderDocumentFileName(document);
    return new Response(null, {
      headers: managedFileStreamHeaders({ mimeType: document.mimeType || "application/pdf", fileName, disposition: "inline" }),
    });
  } catch (error: unknown) {
    return previewErrorResponse((error || {}) as ErrorLike);
  }
}
