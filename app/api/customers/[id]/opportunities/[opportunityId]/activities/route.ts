import type { NextRequest } from "next/server";
import { addCustomerOpportunityActivity, apiError, ok, parseJsonBody } from "../../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; opportunityId: string }> };

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const actor = await requireApiActor(request);
    const { id, opportunityId } = await params;
    const body = await parseJsonBody(request);
    return ok({ activity: await addCustomerOpportunityActivity(request, actor, id, opportunityId, body), message: "跟进记录已保存" });
  } catch (error) {
    return apiError(error, "保存跟进记录失败");
  }
}
