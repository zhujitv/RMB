import type { NextRequest } from "next/server";
import { apiError, getActor, ok, recognizeUploadedCustomsDocument } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type CustomsRecognitionRouteResult = {
  order?: unknown;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await recognizeUploadedCustomsDocument(request, actor, id, {
      confirmOverride: body.confirmOverride === true,
    }) as CustomsRecognitionRouteResult;
    return ok({
      success: true,
      data: result,
      customsRecognition: result,
      order: result?.order || null,
      message: "报关单识别已完成",
    });
  } catch (error: unknown) {
    return apiError(error, "报关单识别失败");
  }
}
