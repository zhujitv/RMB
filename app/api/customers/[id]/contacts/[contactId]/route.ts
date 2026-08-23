import type { NextRequest } from "next/server";
import { apiError, ok, parseJsonBody, removeCustomerContact, saveCustomerContact } from "../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; contactId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id, contactId } = await params; const body = await parseJsonBody(request); return ok({ contact: await saveCustomerContact(request, actor, id, body, contactId), message: "联系人已更新" }); }
  catch (error) { return apiError(error, "更新客户联系人失败"); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try { const actor = await requireApiActor(request); const { id, contactId } = await params; await removeCustomerContact(request, actor, id, contactId); return ok({ message: "联系人已移除" }); }
  catch (error) { return apiError(error, "移除客户联系人失败"); }
}
