import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  ensureQuotationDocument,
  managedFileStreamHeaders,
  parseJsonBody,
  readQuotationDocument,
} from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request, { allowEmpty: true });
    const document = await ensureQuotationDocument(request, actor, id, body);
    return NextResponse.json({ success: true, document });
  } catch (error: unknown) {
    return apiError(error, "生成形式发票失败");
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const query = new URL(request.url).searchParams;
    const file = await readQuotationDocument(actor, id, query.get("versionNumber"));
    const disposition = query.get("download") === "1" ? "attachment" : "inline";
    const headers = managedFileStreamHeaders({
      bodyLength: file.body.byteLength,
      mimeType: "application/pdf",
      fileName: file.asset.fileName,
      disposition,
    });
    headers["Cache-Control"] = "private, no-store, max-age=0, must-revalidate";
    return new NextResponse(new Uint8Array(file.body), {
      headers: { ...headers, Pragma: "no-cache", Expires: "0" },
    });
  } catch (error: unknown) {
    return apiError(error, "读取形式发票失败");
  }
}
