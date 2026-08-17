import { type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, ok, parseJsonBody, reviewSupplierTaxContract } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    const input = await parseJsonBody(request);
    const result = await reviewSupplierTaxContract(request, actor, id, input);
    return ok({ request: result, data: result, message: input?.decision === "APPROVED" ? "合同已确认并发送给供应商" : "合同草稿已驳回" });
  } catch (error) {
    return apiError(error, "审核退税合同失败");
  }
}
