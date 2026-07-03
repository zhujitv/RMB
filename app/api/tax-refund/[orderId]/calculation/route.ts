import type { NextRequest } from "next/server";
import { apiError, codedError } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    await requireApiActor(request);
    await params;
    throw codedError("退税计算功能已停用，请使用资料完整度和人工维护流程。", 410, "TAX_REFUND_CALCULATION_DISABLED");
  } catch (error: unknown) {
    return apiError(error, "退税计算功能已停用");
  }
}
