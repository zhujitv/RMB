import type { NextRequest } from "next/server";
import {
  apiError,
  recordQuotationDecision,
} from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    return await recordQuotationDecision(request, actor, id, null);
  } catch (error: unknown) {
    return apiError(error, "登记客户反馈失败");
  }
}
