import { NextResponse, type NextRequest } from "next/server";
import { requireApiWrite } from "../../../../../lib/api-route-guard";
import { apiError } from "../../../../../lib/platform-db";
import { runTencentCustomsOcrExperiment } from "../../../../../lib/platform/tencent-customs-ocr-experiment";
import { assertMultipartRequestWithinLimit } from "../../../../../lib/platform/upload-request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiWrite(request, "settings");
    assertMultipartRequestWithinLimit(request, {
      maxBytes: 8 * 1024 * 1024,
      message: "腾讯云报关单测试文件请压缩到约7MB以内。",
      code: "TENCENT_OCR_TEST_BODY_TOO_LARGE",
    });
    const formData = await request.formData();
    const result = await runTencentCustomsOcrExperiment(request, actor, formData.get("file"));
    return NextResponse.json({ success: true, result, message: "腾讯云报关单 OCR 测试完成" });
  } catch (error: unknown) {
    return apiError(error, "腾讯云报关单 OCR 测试失败");
  }
}
