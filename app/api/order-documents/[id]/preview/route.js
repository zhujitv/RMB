import { apiError, getActor, getOrderDocumentPreview } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asciiFileName(name = "document.pdf") {
  return String(name || "document.pdf").replace(/[\r\n"]/g, "_");
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
    return apiError(error, "预览订单单证失败");
  }
}
