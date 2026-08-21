import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  parseInboundCrmEmailRequest,
  recordInboundCustomerCrmEmailMessage,
} from "../../../../lib/platform-db";
import { assertMultipartRequestWithinLimit } from "../../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";

const MAX_CRM_EMAIL_MULTIPART_BYTES = 22 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    if (contentType.startsWith("multipart/form-data;")) {
      assertMultipartRequestWithinLimit(request, {
        maxBytes: MAX_CRM_EMAIL_MULTIPART_BYTES,
        message: "入站邮件附件总大小不能超过 20MB。",
        code: "CRM_EMAIL_INBOUND_MULTIPART_TOO_LARGE",
      });
    }
    const { body, files } = await parseInboundCrmEmailRequest(request);
    const result = await recordInboundCustomerCrmEmailMessage(request, body, files);
    return NextResponse.json({ success: true, data: result.message, message: result.deliveryMessage }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "接收客户邮件失败");
  }
}
