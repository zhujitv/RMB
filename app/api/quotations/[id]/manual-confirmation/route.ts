import { NextResponse, type NextRequest } from "next/server";
import { requireApiActor } from "../../../../../lib/api-route-guard";
import { apiError, parseJsonBody } from "../../../../../lib/platform-db";
import { recordManualQuotationConfirmation } from "../../../../../lib/platform/quotation-manual-confirmation-service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const quotation = await recordManualQuotationConfirmation(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: quotation,
      quotation,
      message: "已手动登记客户接受报价",
    });
  } catch (error: unknown) {
    return apiError(error, "手动确认报价失败");
  }
}
