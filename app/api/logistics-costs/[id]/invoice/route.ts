import { NextResponse, type NextRequest } from "next/server";
import { apiError, deleteLogisticsExpenseInvoice, parseJsonBody, uploadLogisticsExpenseInvoice } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";
import { assertMultipartRequestWithinLimit } from "../../../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    assertMultipartRequestWithinLimit(request);
    const formData = await request.formData();
    const result = await uploadLogisticsExpenseInvoice(request, actor, id, formData);
    return NextResponse.json({ success: true, ...result, message: "上传成功" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "上传物流发票失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request, { allowEmpty: true });
    const result = await deleteLogisticsExpenseInvoice(request, actor, id, body);
    return NextResponse.json({ success: true, ...result, message: "已删除发票" });
  } catch (error: unknown) {
    return apiError(error, "删除发票失败");
  }
}
