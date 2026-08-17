import { type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, ok, parseJsonBody, reviewSupplierInvoice } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    const input = await parseJsonBody(request);
    const result = await reviewSupplierInvoice(request, actor, id, input);
    return ok({ request: result, data: result, message: input?.decision === "CONFIRMED" ? "发票已人工确认" : "发票已驳回" });
  } catch (error) {
    return apiError(error, "审核供应商发票失败");
  }
}
