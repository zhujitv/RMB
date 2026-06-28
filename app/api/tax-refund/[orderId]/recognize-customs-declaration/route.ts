import type { NextRequest } from "next/server";
import { apiError, ok, recognizeOrderCustomsDeclaration } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ orderId: string }>;
};

type CustomsRecognitionRouteResult = {
  order?: unknown;
  customsParseMessage?: string;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { orderId } = await params;
    const result = await recognizeOrderCustomsDeclaration(request, actor, orderId) as CustomsRecognitionRouteResult;
    return ok({
      success: true,
      data: result,
      customsRecognition: result,
      order: result?.order || null,
      message: result?.customsParseMessage || "报关单信息已重新识别",
    });
  } catch (error: unknown) {
    return apiError(error, "重新识别报关单失败");
  }
}
