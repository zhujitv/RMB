import type { NextRequest } from "next/server";
import { apiError, ok, uploadProductSupplierCostPaymentVoucher } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { assertMultipartRequestWithinLimit } from "../../../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    assertMultipartRequestWithinLimit(request);
    const formData = await request.formData();
    const cost = await uploadProductSupplierCostPaymentVoucher(request, actor, id, formData.get("file"));
    return ok({ success: true, cost, message: "付款凭证已上传" });
  } catch (error: unknown) {
    return apiError(error, "上传付款凭证失败");
  }
}
