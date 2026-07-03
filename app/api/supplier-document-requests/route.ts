import { NextResponse, type NextRequest } from "next/server";
import { apiError, createSupplierDocumentRequest, listSupplierDocumentRequests, ok } from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    const result = await listSupplierDocumentRequests(query, actor);
    return ok({
      requests: result.rows,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
      summary: result.summary,
    });
  } catch (error: unknown) {
    return apiError(error, "读取供应商资料回传任务失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const formData = await request.formData();
    const requestRow = await createSupplierDocumentRequest(request, actor, {
      costId: String(formData.get("costId") || ""),
      orderId: String(formData.get("orderId") || ""),
      supplierId: String(formData.get("supplierId") || ""),
      requiredDocumentTypes: String(formData.get("requiredDocumentTypes") || ""),
      dueDate: String(formData.get("dueDate") || ""),
      message: String(formData.get("message") || ""),
    }, formData.get("templateFile"));
    return NextResponse.json({
      success: true,
      request: requestRow,
      data: requestRow,
      message: requestRow.sendStatus === "sent"
        ? "已通知供应商回传资料"
        : "已创建回传任务，但邮件发送失败，请检查邮箱配置后重试",
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "创建供应商资料回传任务失败");
  }
}
