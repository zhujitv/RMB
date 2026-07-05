import type { NextRequest } from "next/server";
import { apiError, ok, reparseTaxRefundCustomsDeclarationPdf } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    const result = await reparseTaxRefundCustomsDeclarationPdf(request, actor, orderId);
    return ok({
      success: true,
      order: result.order,
      customsPdfTextParse: result.parse,
      message: "报关单信息已重新读取",
    });
  } catch (error: unknown) {
    return apiError(error, "重新读取报关单信息失败");
  }
}
