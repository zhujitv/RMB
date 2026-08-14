import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError } from "../../../../../../../lib/platform-db";
import { assertMultipartRequestWithinLimit } from "../../../../../../../lib/platform/upload-request-guard";
import { uploadFactoryConfirmationEvidence } from "../../../../../../../lib/platform/factory-purchase-order-confirmation-evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = { params: Promise<{ id: string; purchaseOrderId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    assertMultipartRequestWithinLimit(request);
    const { id, purchaseOrderId } = await params;
    const formData = await request.formData();
    const evidence = await uploadFactoryConfirmationEvidence(request, actor, id, purchaseOrderId, {
      eventKind: formData.get("eventKind"),
      eventId: formData.get("eventId"),
      file: formData.get("file"),
    });
    return NextResponse.json({ success: true, data: evidence, evidence, message: "确认凭证已上传" });
  } catch (error: unknown) {
    return apiError(error, "上传确认凭证失败");
  }
}
