import { NextResponse, type NextRequest } from "next/server";
import { apiError, codedError, createSupplierDocumentRequest, listSupplierDocumentRequests, logServerError, ok } from "../../../lib/platform-db";
import {
  DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE,
  DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_MESSAGE,
} from "../../../lib/platform/supplier-document-request-types";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const SUPPLIER_DOCUMENT_REQUEST_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

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
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > SUPPLIER_DOCUMENT_REQUEST_BODY_LIMIT_BYTES) {
      throw codedError("回传表格请求体过大，请确认 Excel 文件小于 4MB 后重新上传。", 413, "SUPPLIER_DOCUMENT_REQUEST_BODY_TOO_LARGE");
    }
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error: unknown) {
      logServerError("供应商资料回传任务表单解析失败", error, { contentLength });
      throw codedError("回传表格读取失败，请确认文件小于 4MB 且格式为 .xls / .xlsx。", 400, "SUPPLIER_DOCUMENT_FORM_PARSE_FAILED");
    }
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
    if ((error as { code?: string })?.code === DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE) {
      return NextResponse.json(
        {
          error: DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE,
          message: (error as { message?: string })?.message || DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_MESSAGE,
        },
        { status: 409 },
      );
    }
    return apiError(error, "创建供应商资料回传任务失败");
  }
}
