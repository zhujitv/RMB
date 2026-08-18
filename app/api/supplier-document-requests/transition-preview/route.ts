import { type NextRequest } from "next/server";
import { requireApiActor } from "../../../../lib/api-route-guard";
import { apiError, ok, parseJsonBody, previewFactoryPurchaseTransitionSettlement } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const input = await parseJsonBody(request);
    const preview = await previewFactoryPurchaseTransitionSettlement(String(input.costId || ""), actor);
    return ok({ preview });
  } catch (error: unknown) {
    return apiError(error, "读取过渡结算报关商品失败");
  }
}
