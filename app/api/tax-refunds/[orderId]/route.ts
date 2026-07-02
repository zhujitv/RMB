import type { NextRequest } from "next/server";
import {
  apiError,
  cancelTaxRefundArchive,
  createCompanyHsFromDeclarationItem,
  extractCustomsDeclarationItemsFromDocument,
  getTaxRefundOrderDetail,
  ok,
  parseJsonBody,
  recalculateExportTaxRefund,
  prepareManualShippingDocumentsNotification,
  previewCustomsRecognition,
  reparseCustomsRecognition,
  requireText,
  resendShippingDocumentsNotification,
  refreshTaxRefundCompletenessNow,
  saveCustomsDeclarationItems,
  sendManualShippingDocumentsNotification,
  updateCustomsRecognition,
  updateTaxRefundStatus,
} from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

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
    return apiError(error, "读取退税资料详情失败");
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
    if (body.action === "previewCustomsRecognition") {
      const result = await previewCustomsRecognition(actor, orderId);
      return ok({ success: true, data: result, message: "报关单识别结果已生成" });
    }
    if (body.action === "reparseCustomsRecognition") {
      const order = await reparseCustomsRecognition(request, actor, orderId, body);
      return ok({ success: true, order, message: "报关单信息已重新识别" });
    }
    if (body.action === "resendShippingDocuments") {
      const order = await resendShippingDocumentsNotification(request, actor, orderId);
      return ok({ success: true, order, message: "清关资料通知已处理" });
    }
    if (body.action === "prepareManualShippingDocuments") {
      const data = await prepareManualShippingDocumentsNotification(actor, orderId);
      return ok({ success: true, data, message: "清关资料发送信息已生成" });
    }
    if (body.action === "sendManualShippingDocuments") {
      const order = await sendManualShippingDocumentsNotification(request, actor, orderId, body);
      return ok({ success: true, order, message: "清关资料已发送" });
    }
    if (body.action === "refreshCompleteness") {
      const order = await refreshTaxRefundCompletenessNow(request, actor, orderId);
      return ok({ success: true, order, message: "退税完整度已重新计算" });
    }
    if (body.action === "extractCustomsDeclarationItems") {
      const documentId = requireText(body.documentId, "报关单文件");
      const data = await extractCustomsDeclarationItemsFromDocument(request, actor, orderId, documentId);
      const order = await getTaxRefundOrderDetail(orderId, actor);
      return ok({ success: true, order, data, message: "报关商品明细已识别，请确认" });
    }
    if (body.action === "confirmCustomsDeclarationItems") {
      const items = Array.isArray(body.items) ? body.items : [];
      const data = await saveCustomsDeclarationItems(request, actor, orderId, items as never);
      const order = await getTaxRefundOrderDetail(orderId, actor);
      return ok({ success: true, order, data, message: "报关商品明细已确认，退税金额已重新计算" });
    }
    if (body.action === "recalculateTaxRefund") {
      const data = await recalculateExportTaxRefund(request, actor, orderId);
      const order = await getTaxRefundOrderDetail(orderId, actor);
      return ok({ success: true, order, data, message: "退税金额已重新计算" });
    }
    if (body.action === "createCompanyHsFromDeclarationItem") {
      const data = await createCompanyHsFromDeclarationItem(request, actor, orderId, body);
      const order = await getTaxRefundOrderDetail(orderId, actor);
      return ok({ success: true, order, data, message: "企业HS编码已新增，退税金额已重新计算" });
    }
    const status = requireText(body.status, "退税状态");
    const order = await updateTaxRefundStatus(request, actor, orderId, status, body);
    return ok({ success: true, order, message: status === "SUBMITTED" ? "退税资料已提交并归档" : "退税状态已更新" });
  } catch (error: unknown) {
    return apiError(error, "更新退税状态失败");
  }
}
