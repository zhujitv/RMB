import { type NextRequest } from "next/server";
import { requireApiRead, requireApiWrite } from "../../../../../../../lib/api-route-guard";
import { apiError } from "../../../../../../../lib/platform-db";
import {
  deleteFactoryPurchaseOrderDispatchAttachment,
  readFactoryPurchaseOrderDispatchAttachment,
  uploadFactoryPurchaseOrderDispatchAttachment,
} from "../../../../../../../lib/platform/factory-purchase-order-dispatch-attachment";
import { managedFileStreamHeaders } from "../../../../../../../lib/platform/file-center";
import { assertMultipartRequestWithinLimit } from "../../../../../../../lib/platform/upload-request-guard";

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
    const attachment = await uploadFactoryPurchaseOrderDispatchAttachment(
      request,
      actor,
      id,
      purchaseOrderId,
      {
        file: formData.get("file"),
        confirmedSupplierSafe: formData.get("confirmedSupplierSafe"),
      },
    );
    return Response.json({ success: true, data: attachment, attachment, message: "采购明细附件已保存" });
  } catch (error: unknown) {
    return apiError(error, "上传采购明细附件失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiWrite(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    await deleteFactoryPurchaseOrderDispatchAttachment(request, actor, id, purchaseOrderId);
    return Response.json({ success: true, message: "采购明细附件已删除" });
  } catch (error: unknown) {
    return apiError(error, "删除采购明细附件失败");
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiRead(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const attachment = await readFactoryPurchaseOrderDispatchAttachment(actor, id, purchaseOrderId);
    return new Response(new Uint8Array(attachment.body || []), {
      headers: {
        ...managedFileStreamHeaders({
          bodyLength: attachment.body?.length,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
          disposition: "attachment",
        }),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取采购明细附件失败");
  }
}

export async function HEAD(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiRead(request, "salesExecution");
    const { id, purchaseOrderId } = await params;
    const attachment = await readFactoryPurchaseOrderDispatchAttachment(actor, id, purchaseOrderId, false);
    return new Response(null, {
      headers: {
        ...managedFileStreamHeaders({
          bodyLength: attachment.fileSize,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
          disposition: "attachment",
        }),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取采购明细附件失败");
  }
}
