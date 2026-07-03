import type { NextRequest } from "next/server";
import { apiError, codedError } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    await requireApiActor(request);
    await params;
    throw codedError("退税资料报关单 OCR 已停用，请手工维护报关单号和申报日期。", 410, "TAX_REFUND_CUSTOMS_OCR_DISABLED");
  } catch (error: unknown) {
    return apiError(error, "退税资料报关单 OCR 已停用");
  }
}
