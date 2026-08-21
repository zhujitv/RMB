import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  createCustomerCrmEmailMessage,
  listCustomerCrmEmailMessages,
  parseCrmEmailMessageRequestBody,
} from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";
import { assertMultipartRequestWithinLimit } from "../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";

const MAX_CRM_EMAIL_MULTIPART_BYTES = 22 * 1024 * 1024;

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const data = await listCustomerCrmEmailMessages(new URL(request.url).searchParams, actor);
    return NextResponse.json({ success: true, data, rows: data.rows });
  } catch (error: unknown) {
    return apiError(error, "读取客户邮件往来失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const contentType = String(request.headers.get("content-type") || "").toLowerCase();
    if (contentType.startsWith("multipart/form-data;")) {
      assertMultipartRequestWithinLimit(request, {
        maxBytes: MAX_CRM_EMAIL_MULTIPART_BYTES,
        message: "邮件附件总大小不能超过 20MB。",
        code: "CRM_EMAIL_MULTIPART_TOO_LARGE",
      });
    }
    const { body, files } = await parseCrmEmailMessageRequestBody(request);
    const result = await createCustomerCrmEmailMessage(request, actor, body, files);
    return NextResponse.json({
      success: true,
      data: result.message,
      message: result.deliveryMessage,
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存客户邮件失败");
  }
}
