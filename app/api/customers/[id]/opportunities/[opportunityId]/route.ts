import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, removeCustomerOpportunity, saveCustomerOpportunity } from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; opportunityId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id, opportunityId } = await params; const body = await parseJsonBody(request); return ok({ opportunity: await saveCustomerOpportunity(request, actor, id, body, opportunityId), message: "客户采购项目已更新" }); }
  catch (error) { return apiError(error, "更新客户采购项目失败"); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id, opportunityId } = await params; await removeCustomerOpportunity(request, actor, id, opportunityId); return ok({ message: "客户采购项目已移除" }); }
  catch (error) { return apiError(error, "移除客户采购项目失败"); }
}
