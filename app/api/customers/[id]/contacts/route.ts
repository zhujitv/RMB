import type { NextRequest } from "next/server";
import { apiError, listCustomerContacts, ok, parseJsonBody, saveCustomerContact } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id } = await params; return ok({ contacts: await listCustomerContacts(id, actor) }); }
  catch (error) { return apiError(error, "读取客户联系人失败"); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id } = await params; const body = await parseJsonBody(request); return ok({ contact: await saveCustomerContact(request, actor, id, body), message: "联系人已保存" }); }
  catch (error) { return apiError(error, "保存客户联系人失败"); }
}
