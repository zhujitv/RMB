import type { NextRequest } from "next/server";
import { apiError, ok, unmarkCustomerCommunicationSent } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    return ok({
      success: true,
      detail: await unmarkCustomerCommunicationSent(request, actor, orderId),
      message: "已取消手动发送标记。",
    });
  } catch (error: unknown) {
    return apiError(error, "取消手动发送标记失败");
  }
}
