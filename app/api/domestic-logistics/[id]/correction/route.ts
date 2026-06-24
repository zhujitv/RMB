import type { NextRequest } from "next/server";
import { apiError, getActor, ok, parseJsonBody, requestDomesticLogisticsCorrection } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const info = await requestDomesticLogisticsCorrection(request, actor, id, body);
    return ok({ success: true, info, message: "更正申请已提交" });
  } catch (error: unknown) {
    return apiError(error, "提交更正申请失败");
  }
}
