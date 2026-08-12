import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  getQuotation,
  parseJsonBody,
  updateQuotation,
  voidQuotation,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const quotation = await getQuotation(id, actor);
    return NextResponse.json({ success: true, data: quotation, quotation });
  } catch (error: unknown) {
    return apiError(error, "读取报价详情失败");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const quotation = await updateQuotation(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: quotation,
      quotation,
      message: "报价草稿已更新并生成新版本",
    });
  } catch (error: unknown) {
    return apiError(error, "更新报价失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request, { allowEmpty: true });
    const quotation = await voidQuotation(request, actor, id, body);
    return NextResponse.json({
      success: true,
      data: quotation,
      quotation,
      message: "报价已作废",
    });
  } catch (error: unknown) {
    return apiError(error, "作废报价失败");
  }
}
