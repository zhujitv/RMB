import { NextResponse, type NextRequest } from "next/server";
import { apiErrorWithLegacyShape, parseJsonBody, transferOrderBusinessEntity } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const result = await transferOrderBusinessEntity(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: result,
      message: result.changed ? "业务主体已转移" : "业务主体未变化",
    });
  } catch (error: unknown) {
    return apiErrorWithLegacyShape(error, "转移业务主体失败", "BUSINESS_ENTITY_TRANSFER_FAILED");
  }
}
