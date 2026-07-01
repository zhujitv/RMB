import { NextResponse, type NextRequest } from "next/server";
import { apiError, parseJsonBody, transferOrderBusinessEntity } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
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
    const typedError = (error || {}) as ErrorLike;
    return NextResponse.json({
      success: false,
      errorCode: typedError.code || "BUSINESS_ENTITY_TRANSFER_FAILED",
      message: typedError.message || "转移业务主体失败",
    }, { status: typedError.status || 500 });
  }
}
