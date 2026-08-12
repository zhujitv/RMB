import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  createQuotation,
  listQuotations,
  parseJsonBody,
} from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const data = await listQuotations(new URL(request.url).searchParams, actor);
    return NextResponse.json({ success: true, data, quotations: data.rows });
  } catch (error: unknown) {
    return apiError(error, "读取报价失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const quotation = await createQuotation(request, actor, body);
    return NextResponse.json({
      success: true,
      data: quotation,
      quotation,
      message: "报价草稿已创建",
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "创建报价失败");
  }
}
