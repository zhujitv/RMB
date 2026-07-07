import type { NextRequest } from "next/server";
import { apiError, markCustomerCommunicationSent, ok, parseJsonBody } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    const body = await parseJsonBody(request) as Record<string, unknown>;
    return ok({
      success: true,
      detail: await markCustomerCommunicationSent(request, actor, orderId, body),
      message: "已手动标记为已发送。",
    });
  } catch (error: unknown) {
    return apiError(error, "手动标记已发送失败");
  }
}
