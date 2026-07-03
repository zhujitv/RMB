import type { NextRequest } from "next/server";
import { apiError, listCustomerCommunications, ok } from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    return ok(await listCustomerCommunications(query, actor));
  } catch (error: unknown) {
    return apiError(error, "读取客户沟通列表失败");
  }
}
