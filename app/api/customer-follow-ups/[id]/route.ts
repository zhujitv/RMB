import { NextResponse, type NextRequest } from "next/server";
import { apiError, completeCustomerFollowUp, parseJsonBody } from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    await parseJsonBody(request, { allowEmpty: true });
    const followUp = await completeCustomerFollowUp(request, actor, id);
    return NextResponse.json({
      success: true,
      data: followUp,
      followUp,
      message: "跟进已完成",
    });
  } catch (error: unknown) {
    return apiError(error, "更新客户跟进记录失败");
  }
}
