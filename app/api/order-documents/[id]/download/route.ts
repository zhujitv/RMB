import { apiError, getOrderDocumentDownload, managedFileStreamHeaders, preferredOrderDocumentFileName } from "../../../../../lib/platform-db";
import type { NextRequest } from "next/server";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const { body, document, mimeType } = await getOrderDocumentDownload(request, actor, id);
    const fileName = preferredOrderDocumentFileName(document);
    return new Response(new Uint8Array(body), {
      headers: managedFileStreamHeaders({ bodyLength: body.length, mimeType: mimeType || "application/pdf", fileName, disposition: "attachment" }),
    });
  } catch (error: unknown) {
    return apiError(error, "下载订单单证失败");
  }
}
