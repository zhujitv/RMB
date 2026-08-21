import { NextResponse, type NextRequest } from "next/server";
import { apiError, deleteSupplierDocumentRequest, getSupplierDocumentRequestDetail, parseJsonBody, resendSupplierDocumentRequestNotice, revokeSupplierDocumentTransitionSettlement } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const requestRow = await getSupplierDocumentRequestDetail(id, actor);
    return NextResponse.json({
      success: true,
      request: requestRow,
      data: requestRow,
    });
  } catch (error: unknown) {
    return apiError(error, "读取资料回传任务详情失败");
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request).catch(() => ({})) as { action?: string; reason?: string };
    if (body.action === "revokeTransitionSettlement") {
      const requestRow = await revokeSupplierDocumentTransitionSettlement(request, actor, id, body);
      return NextResponse.json({
        success: true,
        request: requestRow,
        data: requestRow,
        message: "过渡结算凭证已撤销，可重新创建资料回传任务。",
      });
    }
    if (body.action !== "resendNotice") {
      return NextResponse.json({ success: false, message: "不支持的资料回传操作" }, { status: 400 });
    }
    const requestRow = await resendSupplierDocumentRequestNotice(request, actor, id);
    return NextResponse.json({
      success: true,
      request: requestRow,
      message: requestRow.sendStatus === "sent" ? "催办邮件已重新发送" : "催办邮件发送失败，请检查邮箱配置",
    });
  } catch (error: unknown) {
    return apiError(error, "重新发送资料回传催办失败");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const result = await deleteSupplierDocumentRequest(request, actor, id);
    return NextResponse.json({
      success: true,
      ...result,
      message: "已删除资料回传任务",
    });
  } catch (error: unknown) {
    return apiError(error, "删除资料回传任务失败");
  }
}
