import { NextResponse, type NextRequest } from "next/server";
import { apiError, createSupplierTaxContractRequest, listSupplierDocumentRequests, ok } from "../../../lib/platform-db";
import {
  DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_CODE,
  DUPLICATE_SUPPLIER_DOCUMENT_REQUEST_MESSAGE,
} from "../../../lib/platform/supplier-document-request-types";

import { requireApiActor } from "../../../lib/api-route-guard";
import { assertMultipartRequestWithinLimit } from "../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const REQUEST_BODY_LIMIT_BYTES = 128 * 1024;

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
    });
  } catch (error: unknown) {
    return apiError(error, "读取供应商资料回传任务失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    assertMultipartRequestWithinLimit(request, {
      maxBytes: REQUEST_BODY_LIMIT_BYTES,
      message: "合同草稿请求体过大。",
      code: "SUPPLIER_TAX_CONTRACT_REQUEST_TOO_LARGE",
    });
    const formData = await request.formData();
    const requestRow = await createSupplierTaxContractRequest(request, actor, {
      costId: String(formData.get("costId") || ""),
      orderId: String(formData.get("orderId") || ""),
      supplierId: String(formData.get("supplierId") || ""),
      requiredDocumentTypes: String(formData.get("requiredDocumentTypes") || ""),
      dueDate: String(formData.get("dueDate") || ""),
      message: String(formData.get("message") || ""),
      transitionItems: String(formData.get("transitionItems") || ""),
      transitionIncreaseAmount: String(formData.get("transitionIncreaseAmount") || "0"),
      transitionDecreaseAmount: String(formData.get("transitionDecreaseAmount") || "0"),
      transitionReason: String(formData.get("transitionReason") || ""),
      transitionConfirmed: String(formData.get("transitionConfirmed") || "") === "true",
    });
    return NextResponse.json({
      success: true,
      request: requestRow,
      data: requestRow,
      message: "合同草稿已生成，请人工审核确认后发送给供应商",
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
