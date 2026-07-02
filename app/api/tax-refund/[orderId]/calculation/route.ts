import type { NextRequest } from "next/server";
import { apiError, getTaxRefundOrderDetailSection, ok } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    return ok({ order: await getTaxRefundOrderDetailSection(orderId, actor, "calculation") });
  } catch (error: unknown) {
    return apiError(error, "读取退税计算失败");
  }
}
