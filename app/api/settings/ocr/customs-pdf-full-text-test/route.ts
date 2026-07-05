import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  readValidatedPdfUploadFile,
  testCustomsDeclarationPdfFullTextParse,
} from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const formData = await request.formData();
    const file = await readValidatedPdfUploadFile(formData.get("file"), "customs-declaration-full-text-test.pdf");
    const result = await testCustomsDeclarationPdfFullTextParse(actor, file);
    return ok({
      ...result,
      message: "PDF报关单整单文本解析测试完成",
    });
  } catch (error: unknown) {
    return apiError(error, "PDF报关单整单文本解析测试失败");
  }
}
