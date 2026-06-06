import { getActor, getOrderDocumentPreview } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asciiFileName(name = "document.pdf") {
  const cleaned = String(name || "document.pdf")
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/[\\/:*?<>|]+/g, "_");
  return cleaned || "document.pdf";
}

function previewErrorResponse(error) {
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

export async function GET(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const { body, document } = await getOrderDocumentPreview(request, actor, id);
    const fileName = asciiFileName(document.fileName || "document.pdf");
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.length),
        "Content-Disposition": `inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(document.fileName || "document.pdf")}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return previewErrorResponse(error);
  }
}
