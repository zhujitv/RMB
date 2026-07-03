import type { NextRequest } from "next/server";
import { apiError, codedError } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireApiActor(request);
    throw codedError("退税资料报关单 OCR 已停用，请手工维护报关单信息。", 410, "TAX_REFUND_CUSTOMS_OCR_DISABLED");
  } catch (error: unknown) {
    return apiError(error, "退税资料报关单 OCR 已停用");
  }
}
