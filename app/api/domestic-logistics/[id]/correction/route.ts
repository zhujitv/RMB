import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, requestDomesticLogisticsCorrection } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const info = await requestDomesticLogisticsCorrection(request, actor, id, body);
    return ok({ success: true, info, message: "更正申请已提交" });
  } catch (error: unknown) {
    return apiError(error, "提交更正申请失败");
  }
}
