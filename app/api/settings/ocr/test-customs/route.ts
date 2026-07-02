import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  readValidatedPdfUploadFile,
  testCustomsDeclarationOcr,
} from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const formData = await request.formData();
    const file = await readValidatedPdfUploadFile(formData.get("file"), "customs-declaration-test.pdf");
    const result = await testCustomsDeclarationOcr(actor, file);
    return ok({
      success: true,
      result,
      message: "报关单识别测试完成",
    });
  } catch (error: unknown) {
    return apiError(error, "测试报关单识别失败");
  }
}
