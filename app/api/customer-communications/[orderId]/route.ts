import type { NextRequest } from "next/server";
import {
  apiError,
  codedError,
  getCustomerCommunicationDetail,
  ok,
  parseJsonBody,
  sendCustomerCommunicationClearanceDocuments,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    return ok(await getCustomerCommunicationDetail(orderId, actor));
  } catch (error: unknown) {
    return apiError(error, "读取客户沟通详情失败");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    const body = await parseJsonBody(request) as Record<string, unknown>;
    const action = String(body.action || "");
    if (action !== "sendCustomsClearanceDocs") {
      throw codedError("未知客户沟通操作", 400, "INVALID_CUSTOMER_COMMUNICATION_ACTION");
    }
    return ok({
      success: true,
      detail: await sendCustomerCommunicationClearanceDocuments(request, actor, orderId, body),
      message: "清关资料已发送",
    });
  } catch (error: unknown) {
    return apiError(error, "发送客户沟通邮件失败");
  }
}
