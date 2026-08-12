import type { NextRequest } from "next/server";
import {
  apiError,
  getProductSupplierCostPaymentVoucher,
  getProductSupplierCostPaymentVoucherMetadata,
  managedFileStreamHeaders,
} from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function paymentVoucherHeaders(request: NextRequest, bodyLength?: number, mimeType = "application/octet-stream", fileName = "汇款水单.jpg") {
  const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
  return managedFileStreamHeaders({ bodyLength, mimeType, fileName, disposition });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const { body, mimeType, fileName } = await getProductSupplierCostPaymentVoucher(request, actor, id);
    return new Response(new Uint8Array(body), {
      headers: paymentVoucherHeaders(request, body.length, mimeType, fileName),
    });
  } catch (error: unknown) {
    return apiError(error, "读取付款凭证失败");
  }
}

export async function HEAD(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const { mimeType, fileName } = await getProductSupplierCostPaymentVoucherMetadata(request, actor, id);
    return new Response(null, {
      headers: paymentVoucherHeaders(request, undefined, mimeType, fileName),
    });
  } catch (error: unknown) {
    return apiError(error, "读取付款凭证失败");
  }
}
