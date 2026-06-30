import type { NextRequest } from "next/server";
import { apiError, getProductSupplierCostPaymentVoucher } from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function contentDispositionHeader(disposition = "inline", fileName = "汇款水单.jpg") {
  const normalizedDisposition = disposition === "attachment" ? "attachment" : "inline";
  const safeFileName = String(fileName || "汇款水单.jpg").replace(/[\r\n"\\/:*?<>|;]+/g, "_").trim() || "汇款水单.jpg";
  const asciiFileName = safeFileName.replace(/[^\x20-\x7E]/g, "_");
  return `${normalizedDisposition}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const { body, mimeType, fileName } = await getProductSupplierCostPaymentVoucher(request, actor, id);
    return new Response(body, {
      headers: {
        "Content-Type": mimeType || "application/octet-stream",
        "Content-Length": String(body.length),
        "Content-Disposition": contentDispositionHeader("inline", fileName),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取付款凭证失败");
  }
}
