import type { NextRequest } from "next/server";
import {
  apiError,
  cancelTaxRefundArchive,
  codedError,
  getTaxRefundOrderDetail,
  ok,
  parseJsonBody,
  requireText,
  refreshTaxRefundCompletenessNow,
  taxRefundDataReadFailure,
  updateCustomsRecognition,
  updateTaxRefundStatus,
} from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

type TaxRefundPatchBody = Record<string, unknown> & {
  action?: string;
  status?: string;
  cancelArchive?: boolean;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    return ok({ order: await getTaxRefundOrderDetail(orderId, actor) });
  } catch (error: unknown) {
    const { orderId } = await params.catch(() => ({ orderId: "" }));
    return taxRefundDataReadFailure(error, {
      path: request.nextUrl.pathname,
      taxRefundRecordId: orderId,
      orderId,
      api: "GET /api/tax-refunds/[orderId]",
    });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    const body = await parseJsonBody(request) as TaxRefundPatchBody;
    if (body.cancelArchive === true) {
      const order = await cancelTaxRefundArchive(request, actor, orderId, body.status || "NOT_READY", body);
      return ok({ success: true, order, message: "退税资料已取消归档" });
    }
    if (body.action === "updateCustomsRecognition") {
      const order = await updateCustomsRecognition(request, actor, orderId, body);
      return ok({ success: true, order, message: "报关单信息已保存" });
    }
    if ([
      "resendShippingDocuments",
      "prepareManualShippingDocuments",
      "sendManualShippingDocuments",
    ].includes(String(body.action || ""))) {
      throw codedError("清关资料发送已迁移至客户沟通模块，请从客户沟通发起。", 410, "SHIPPING_DOCUMENTS_MOVED_TO_CUSTOMER_COMMUNICATION");
    }
    if (body.action === "refreshCompleteness") {
      const order = await refreshTaxRefundCompletenessNow(request, actor, orderId);
      return ok({ success: true, order, message: "退税完整度已重新计算" });
    }
    if ([
      "previewCustomsRecognition",
      "reparseCustomsRecognition",
      "extractCustomsDeclarationItems",
      "confirmCustomsDeclarationItems",
      "syncCustomsDeclarationItemsFromOcr",
      "recalculateTaxRefund",
    ].includes(String(body.action || ""))) {
      throw codedError("退税资料 OCR 和退税计算功能已停用，请使用资料完整度和人工维护流程。", 410, "TAX_REFUND_OCR_CALC_DISABLED");
    }
    const status = requireText(body.status, "退税状态");
    const order = await updateTaxRefundStatus(request, actor, orderId, status, body);
    return ok({ success: true, order, message: status === "SUBMITTED" ? "退税资料已提交并归档" : "退税状态已更新" });
  } catch (error: unknown) {
    return apiError(error, "更新退税状态失败");
  }
}
