import type { NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, previewSupplierTaxContractDraft } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const { body, mimeType, fileName } = await previewSupplierTaxContractDraft(request, actor, id);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": contentDisposition(fileName),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, "预览合同草稿失败");
  }
}

function contentDisposition(fileName: string) {
  const normalized = String(fileName || "退税合同-草稿.xlsx")
    .replace(/[\u0000-\u001f\u007f\r\n"]/g, "_")
    .replace(/[\\/:*?<>|;]+/g, "_")
    .trim() || "退税合同-草稿.xlsx";
  const asciiName = normalized.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}
