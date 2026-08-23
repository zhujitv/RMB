import type { NextRequest } from "next/server";
import { apiError, listCustomerOpportunities, ok, parseJsonBody, saveCustomerOpportunity } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id } = await params; return ok({ opportunities: await listCustomerOpportunities(id, actor) }); }
  catch (error) { return apiError(error, "读取销售机会失败"); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id } = await params; const body = await parseJsonBody(request); return ok({ opportunity: await saveCustomerOpportunity(request, actor, id, body), message: "销售机会已保存" }); }
  catch (error) { return apiError(error, "保存销售机会失败"); }
}
