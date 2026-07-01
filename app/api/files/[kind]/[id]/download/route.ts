import type { NextRequest } from "next/server";
import {
  apiError,
  getManagedFileDownload,
  getManagedFileMetadata,
  managedFileStreamHeaders,
} from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ kind: string; id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { kind, id } = await params;
    const result = await getManagedFileDownload(request, actor, kind, id);
    return new Response(new Uint8Array(result.body), {
      headers: managedFileStreamHeaders({
        bodyLength: result.body.length,
        mimeType: result.mimeType,
        fileName: result.fileName,
        disposition: "attachment",
      }),
    });
  } catch (error: unknown) {
    return apiError(error, "下载文件失败");
  }
}

export async function HEAD(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { kind, id } = await params;
    const metadata = await getManagedFileMetadata(request, actor, kind, id);
    return new Response(null, {
      headers: managedFileStreamHeaders({
        mimeType: metadata.mimeType,
        fileName: metadata.fileName,
        disposition: "attachment",
      }),
    });
  } catch (error: unknown) {
    return apiError(error, "读取文件失败");
  }
}
