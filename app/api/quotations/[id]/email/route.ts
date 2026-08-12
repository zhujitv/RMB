import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  getQuotationEmailDraft,
  parseJsonBody,
  sendQuotationEmail,
} from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const draft = await getQuotationEmailDraft(actor, id);
    return NextResponse.json({ success: true, draft });
  } catch (error: unknown) {
    return apiError(error, "读取报价邮件草稿失败");
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const delivery = await sendQuotationEmail(request, actor, id, body);
    return NextResponse.json({ success: true, delivery, message: "报价邮件已发送" });
  } catch (error: unknown) {
    return apiError(error, "发送报价邮件失败");
  }
}
