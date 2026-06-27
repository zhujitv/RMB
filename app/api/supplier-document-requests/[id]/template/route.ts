import type { NextRequest } from "next/server";
import { apiError, getActor, getSupplierDocumentRequestTemplate } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const { body, mimeType, fileName } = await getSupplierDocumentRequestTemplate(request, actor, id);
    return new Response(body, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": excelContentDisposition(fileName),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "下载合同样本失败");
  }
}

function excelContentDisposition(fileName = "factory-document-template.xlsx") {
  const safeFileName = String(fileName || "factory-document-template.xlsx")
    .replace(/[\u0000-\u001f\u007f\r\n"]/g, "_")
    .replace(/[\\/:*?<>|;]+/g, "_")
    .trim() || "factory-document-template.xlsx";
  const normalized = /\.xlsx$/i.test(safeFileName) ? safeFileName : `${safeFileName}.xlsx`;
  const asciiFileName = normalized
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}
