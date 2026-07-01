import type { NextRequest } from "next/server";
import {
  getManagedFilePreview,
  getManagedFilePreviewMetadata,
  managedFileStreamHeaders,
} from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ kind: string; id: string }>;
};
type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
};

function previewErrorResponse(error: ErrorLike) {
  const status = error?.status || 500;
  const code = error?.code || (status === 403 ? "PERMISSION_DENIED" : "FILE_PREVIEW_FAILED");
  const message = error?.message || "文件暂时无法预览，请下载查看。";
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
    const actor = await requireApiActor(request);
    const { kind, id } = await params;
    const result = await getManagedFilePreview(request, actor, kind, id);
    return new Response(new Uint8Array(result.body), {
      headers: managedFileStreamHeaders({
        bodyLength: result.body.length,
        mimeType: result.mimeType,
        fileName: result.fileName,
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
    const { kind, id } = await params;
    const metadata = await getManagedFilePreviewMetadata(request, actor, kind, id);
    return new Response(null, {
      headers: managedFileStreamHeaders({
        mimeType: metadata.mimeType,
        fileName: metadata.fileName,
        disposition: "inline",
      }),
    });
  } catch (error: unknown) {
    return previewErrorResponse((error || {}) as ErrorLike);
  }
}
