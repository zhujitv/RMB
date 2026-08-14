import { type NextRequest } from "next/server";
import { requireApiRead } from "../../../../../../../../../lib/api-route-guard";
import { apiError } from "../../../../../../../../../lib/platform-db";
import { managedFileStreamHeaders } from "../../../../../../../../../lib/platform/file-center";
import { readFactoryConfirmationEvidence } from "../../../../../../../../../lib/platform/factory-purchase-order-confirmation-evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string; purchaseOrderId: string; eventKind: string; eventId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiRead(request, "salesExecution");
    const { id, purchaseOrderId, eventKind, eventId } = await params;
    const evidence = await readFactoryConfirmationEvidence(
      actor,
      id,
      purchaseOrderId,
      eventKind,
      eventId,
    );
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new Response(new Uint8Array(evidence.body || []), {
      headers: {
        ...managedFileStreamHeaders({
          bodyLength: evidence.body?.length,
          mimeType: evidence.mimeType,
          fileName: evidence.fileName,
          disposition: download ? "attachment" : "inline",
        }),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取确认凭证失败");
  }
}

export async function HEAD(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiRead(request, "salesExecution");
    const { id, purchaseOrderId, eventKind, eventId } = await params;
    const evidence = await readFactoryConfirmationEvidence(
      actor,
      id,
      purchaseOrderId,
      eventKind,
      eventId,
      false,
    );
    return new Response(null, {
      headers: {
        ...managedFileStreamHeaders({
          mimeType: evidence.mimeType,
          fileName: evidence.fileName,
          disposition: "inline",
        }),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取确认凭证失败");
  }
}
